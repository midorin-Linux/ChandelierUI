use std::{sync::LazyLock, time::Duration};

use futures_util::StreamExt;
use reqwest::{Client, RequestBuilder, StatusCode, Url, redirect::Policy};
use serde_json::Value;
use tokio::{
    sync::mpsc,
    time::{Instant, timeout_at},
};
use tokio_util::sync::CancellationToken;

use crate::domain::{AppError, Provider, Result};

const MAX_FRAME_BYTES: usize = 1024 * 1024;
const MAX_CONTENT_BYTES: usize = 16 * 1024 * 1024;
const MAX_MODELS_BYTES: usize = 4 * 1024 * 1024;

static HTTP_CLIENT: LazyLock<Result<Client>> = LazyLock::new(|| {
    Client::builder()
        .redirect(Policy::none())
        .build()
        .map_err(network_error)
});

#[derive(Debug, Clone, PartialEq)]
pub struct ApiEvent {
    pub at: std::time::Instant,
    pub kind: ApiEventKind,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ApiEventKind {
    Headers,
    Event,
    Content(String),
    Usage(Value),
    Finish(String),
}

pub struct OpenAiAdapter;

/// Base URLs are API roots, not origins: `/v1` remains part of every endpoint.
pub fn validate_base_url(base_url: &str) -> Result<Url> {
    let mut url = Url::parse(base_url).map_err(|_| invalid_url())?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || base_url
            .chars()
            .any(|c| c.is_control() || c.is_whitespace())
        || base_url.contains('@')
    {
        return Err(invalid_url());
    }
    url.set_path(&format!("{}/", url.path().trim_end_matches('/')));
    Ok(url)
}

pub fn validate_provider(provider: &Provider) -> Result<()> {
    validate_base_url(&provider.base_url)?;
    if provider.id.trim().is_empty()
        || provider.name.trim().is_empty()
        || !matches!(provider.authentication_mode.as_str(), "none" | "bearer")
        || provider.timeout_seconds <= 0
        || !provider.default_parameters.is_object()
        || Instant::now()
            .checked_add(Duration::from_secs(provider.timeout_seconds as u64))
            .is_none()
    {
        return Err(AppError::validation("プロバイダー設定が不正です。"));
    }
    Ok(())
}

pub fn validate_model_identifier(identifier: &str) -> Result<()> {
    if identifier.is_empty()
        || identifier
            .chars()
            .any(|c| c.is_whitespace() || c.is_control())
    {
        return Err(AppError::validation(
            "モデル識別子を正しく入力してください。",
        ));
    }
    Ok(())
}

impl OpenAiAdapter {
    pub async fn models(provider: &Provider, api_key: Option<&str>) -> Result<Vec<String>> {
        validate_provider(provider)?;
        let deadline = deadline(provider)?;
        let request = request(provider, api_key, "models", false)?;
        timeout_at(deadline, async {
            let response = request.send().await.map_err(network_error)?;
            check_status(response.status())?;
            let mut bytes = Vec::new();
            let mut chunks = response.bytes_stream();
            while let Some(chunk) = chunks.next().await {
                let chunk = chunk.map_err(network_error)?;
                if bytes.len().saturating_add(chunk.len()) > MAX_MODELS_BYTES {
                    return Err(format_error());
                }
                bytes.extend_from_slice(&chunk);
            }
            let mut value: Value = serde_json::from_slice(&bytes).map_err(|_| format_error())?;
            let data = value
                .as_object_mut()
                .and_then(|object| object.remove("data"))
                .ok_or_else(format_error)?;
            let Value::Array(data) = data else {
                return Err(format_error());
            };
            let mut models = Vec::with_capacity(data.len());
            for mut model in data {
                let id = model
                    .as_object_mut()
                    .and_then(|object| object.remove("id"))
                    .ok_or_else(format_error)?;
                let Value::String(id) = id else {
                    return Err(format_error());
                };
                validate_model_identifier(&id).map_err(|_| format_error())?;
                models.push(id);
            }
            Ok(models)
        })
        .await
        .map_err(|_| timeout_error())?
    }

    /// The deadline and cancellation cover headers, body reads, and bounded-channel sends.
    /// Frames are limited to 1 MiB and accumulated text to 16 MiB; `[DONE]` is mandatory.
    pub async fn stream(
        provider: &Provider,
        api_key: Option<&str>,
        body: &Value,
        cancel: CancellationToken,
        on_event: mpsc::Sender<ApiEvent>,
    ) -> Result<()> {
        if cancel.is_cancelled() {
            return Err(cancelled_error());
        }
        validate_provider(provider)?;
        let model = body
            .as_object()
            .and_then(|object| object.get("model"))
            .and_then(Value::as_str)
            .ok_or_else(|| AppError::validation("モデル識別子が必要です。"))?;
        validate_model_identifier(model)?;
        let deadline = deadline(provider)?;
        let request = request(provider, api_key, "chat/completions", true)?.json(body);
        tokio::select! {
            biased;
            _ = cancel.cancelled() => Err(cancelled_error()),
            result = timeout_at(deadline, async {
                let response = request.send().await.map_err(network_error)?;
                send(&on_event, std::time::Instant::now(), ApiEventKind::Headers).await?;
                check_status(response.status())?;
                if !response.headers().get(reqwest::header::CONTENT_TYPE)
                    .and_then(|value| value.to_str().ok())
                    .is_some_and(|value| value.split(';').next().unwrap_or("").trim().eq_ignore_ascii_case("text/event-stream"))
                {
                    return Err(format_error());
                }
                let mut parser = SseParser::default();
                let mut content_bytes = 0usize;
                let mut chunks = response.bytes_stream();
                while let Some(chunk) = chunks.next().await {
                    let chunk = chunk.map_err(|error| {
                        if error.is_timeout() { timeout_error() } else { disconnected_error() }
                    })?;
                    let at = std::time::Instant::now();
                    for byte in chunk {
                        if let Some(data) = parser.push(byte)? {
                            send(&on_event, at, ApiEventKind::Event).await?;
                            if data == b"[DONE]" { return Ok(()); }
                            let value: Value = serde_json::from_slice(&data).map_err(|_| format_error())?;
                            for event in decode_chunk(value)?.into_iter().flatten() {
                                if let ApiEventKind::Content(content) = &event {
                                    content_bytes = content_bytes.saturating_add(content.len());
                                    if content_bytes > MAX_CONTENT_BYTES { return Err(format_error()); }
                                }
                                send(&on_event, at, event).await?;
                            }
                            parser.data = data;
                            parser.data.clear();
                        }
                    }
                }
                Err(disconnected_error())
            }) => result.map_err(|_| timeout_error())?,
        }
    }
}

fn request(
    provider: &Provider,
    api_key: Option<&str>,
    endpoint: &str,
    streaming: bool,
) -> Result<RequestBuilder> {
    let url = validate_base_url(&provider.base_url)?
        .join(endpoint)
        .map_err(|_| invalid_url())?;
    let client = HTTP_CLIENT.as_ref().map_err(Clone::clone)?;
    let mut request = if streaming {
        client.post(url)
    } else {
        client.get(url)
    };
    request = request.header(
        reqwest::header::ACCEPT,
        if streaming {
            "text/event-stream"
        } else {
            "application/json"
        },
    );
    if provider.authentication_mode == "bearer" {
        let key = api_key
            .filter(|key| !key.trim().is_empty() && !key.chars().any(char::is_control))
            .ok_or_else(|| AppError::new("authentication", "APIキーを確認してください。"))?;
        let mut header = reqwest::header::HeaderValue::from_str(&format!("Bearer {key}"))
            .map_err(|_| AppError::new("authentication", "APIキーを確認してください。"))?;
        header.set_sensitive(true);
        request = request.header(reqwest::header::AUTHORIZATION, header);
    }
    Ok(request)
}

fn deadline(provider: &Provider) -> Result<Instant> {
    Instant::now()
        .checked_add(Duration::from_secs(provider.timeout_seconds as u64))
        .ok_or_else(|| AppError::validation("タイムアウト設定が不正です。"))
}

async fn send(
    sender: &mpsc::Sender<ApiEvent>,
    at: std::time::Instant,
    kind: ApiEventKind,
) -> Result<()> {
    sender
        .send(ApiEvent { at, kind })
        .await
        .map_err(|_| cancelled_error())
}

fn check_status(status: StatusCode) -> Result<()> {
    if status.is_success() {
        return Ok(());
    }
    Err(match status {
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
            AppError::new("authentication", "API認証に失敗しました。")
        }
        StatusCode::TOO_MANY_REQUESTS => AppError::new("rate_limit", "APIの利用制限に達しました。"),
        StatusCode::NOT_FOUND => AppError::new(
            "model_not_found",
            "モデルまたはAPIエンドポイントが見つかりません。",
        ),
        StatusCode::REQUEST_TIMEOUT | StatusCode::GATEWAY_TIMEOUT => timeout_error(),
        _ => AppError::new("api", "APIリクエストに失敗しました。"),
    })
}

fn decode_chunk(value: Value) -> Result<[Option<ApiEventKind>; 3]> {
    let Value::Object(mut object) = value else {
        return Err(format_error());
    };
    if let Some(error) = object.get("error").filter(|error| !error.is_null()) {
        let error = error.as_object().ok_or_else(format_error)?;
        return Err(match error.get("code").and_then(Value::as_str) {
            Some("invalid_api_key" | "authentication_error") => {
                AppError::new("authentication", "API認証に失敗しました。")
            }
            Some("rate_limit_exceeded") => {
                AppError::new("rate_limit", "APIの利用制限に達しました。")
            }
            Some("model_not_found") => AppError::new("model_not_found", "モデルが見つかりません。"),
            _ => AppError::new("api", "APIリクエストに失敗しました。"),
        });
    }
    let usage = object.remove("usage").filter(|usage| !usage.is_null());
    if let Some(usage) = &usage {
        let usage = usage.as_object().ok_or_else(format_error)?;
        for name in ["prompt_tokens", "completion_tokens", "total_tokens"] {
            if usage.get(name).is_some_and(|count| {
                !count.is_null()
                    && !count
                        .as_u64()
                        .is_some_and(|n| n <= crate::domain::MAX_SAFE_INTEGER)
            }) {
                return Err(format_error());
            }
        }
        for name in ["prompt_tokens_details", "completion_tokens_details"] {
            if usage
                .get(name)
                .is_some_and(|details| !details.is_null() && !details.is_object())
            {
                return Err(format_error());
            }
        }
    }
    let mut events = [None, None, None];
    match object.remove("choices") {
        Some(Value::Array(choices)) => {
            if choices.len() > 1 {
                return Err(format_error());
            }
            if choices.is_empty() && usage.is_none() {
                return Err(format_error());
            }
            for choice in choices {
                let Value::Object(mut choice) = choice else {
                    return Err(format_error());
                };
                let Some(Value::Object(mut delta)) = choice.remove("delta") else {
                    return Err(format_error());
                };
                match delta.remove("content") {
                    Some(Value::String(content)) if !content.is_empty() => {
                        events[0] = Some(ApiEventKind::Content(content))
                    }
                    None | Some(Value::Null) | Some(Value::String(_)) => {}
                    _ => return Err(format_error()),
                }
                if delta.get("role").is_some_and(|role| !role.is_string()) {
                    return Err(format_error());
                }
                match choice.remove("finish_reason") {
                    Some(Value::String(reason)) if !reason.is_empty() => {
                        events[1] = Some(ApiEventKind::Finish(reason))
                    }
                    None | Some(Value::Null) => {}
                    _ => return Err(format_error()),
                }
            }
        }
        None if usage.is_some() => {}
        _ => return Err(format_error()),
    }
    events[2] = usage.map(ApiEventKind::Usage);
    Ok(events)
}

/// Split bytes before UTF-8 decoding; CR dispatches immediately and an optional LF is skipped.
#[derive(Default)]
struct SseParser {
    line: Vec<u8>,
    data: Vec<u8>,
    after_cr: bool,
    started: bool,
}

impl SseParser {
    fn push(&mut self, byte: u8) -> Result<Option<Vec<u8>>> {
        if self.after_cr {
            self.after_cr = false;
            if byte == b'\n' {
                return Ok(None);
            }
        }
        match byte {
            b'\r' | b'\n' => {
                self.after_cr = byte == b'\r';
                let line = if self.started {
                    self.line.as_slice()
                } else {
                    self.started = true;
                    self.line
                        .strip_prefix(b"\xef\xbb\xbf")
                        .unwrap_or(&self.line)
                };
                if line.is_empty() {
                    self.line.clear();
                    if self.data.is_empty() {
                        return Ok(None);
                    }
                    self.data.pop();
                    let data = std::mem::take(&mut self.data);
                    return Ok((!data.is_empty()).then_some(data));
                }
                if let Some(mut data) = line.strip_prefix(b"data:") {
                    if data.first() == Some(&b' ') {
                        data = &data[1 ..];
                    }
                    if self.data.len().saturating_add(data.len()).saturating_add(1)
                        > MAX_FRAME_BYTES
                    {
                        return Err(format_error());
                    }
                    self.data.extend_from_slice(data);
                    self.data.push(b'\n');
                } else if line == b"data" {
                    if self.data.len() == MAX_FRAME_BYTES {
                        return Err(format_error());
                    }
                    self.data.push(b'\n');
                }
                self.line.clear();
                Ok(None)
            }
            _ => {
                if self.line.len().saturating_add(self.data.len()) >= MAX_FRAME_BYTES {
                    return Err(format_error());
                }
                self.line.push(byte);
                Ok(None)
            }
        }
    }
}

fn invalid_url() -> AppError {
    AppError::validation(
        "Base URLには認証情報・クエリ・フラグメントのないHTTP(S) URLを指定してください。",
    )
}
fn format_error() -> AppError {
    AppError::new("format", "APIレスポンスの形式が不正です。")
}
fn timeout_error() -> AppError {
    AppError::new("timeout", "APIリクエストがタイムアウトしました。")
}
fn cancelled_error() -> AppError {
    AppError::new("cancelled", "生成を停止しました。")
}
fn disconnected_error() -> AppError {
    AppError::new("disconnected", "APIストリームが完了前に切断されました。")
}
fn network_error(error: reqwest::Error) -> AppError {
    if error.is_timeout() {
        timeout_error()
    } else {
        AppError::new("network", "APIに接続できませんでした。")
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn parser_handles_every_byte_boundary_and_line_ending() {
        for ending in ["\n", "\r\n", "\r"] {
            let source = format!(
                ": keepalive{ending}event: message{ending}data: {{\"choices\": [{ending}data: {{\"delta\": {{\"content\": \"日本語\"}}}}]}}{ending}{ending}data: [DONE]{ending}{ending}"
            );
            let mut parser = SseParser::default();
            let events: Vec<_> = source
                .bytes()
                .filter_map(|byte| parser.push(byte).unwrap())
                .collect();
            assert_eq!(events.len(), 2);
            assert_eq!(
                decode_chunk(serde_json::from_slice(&events[0]).unwrap()).unwrap(),
                [Some(ApiEventKind::Content("日本語".into())), None, None]
            );
            assert_eq!(events[1], b"[DONE]");
        }
    }

    #[test]
    fn leading_bom_does_not_drop_first_content_or_strip_content_bom() {
        let source =
            "\u{feff}data: {\"choices\":[{\"delta\":{\"content\":\"\u{feff}日本語\"}}]}\r\n\r\n";
        let mut parser = SseParser::default();
        let frames: Vec<_> = source
            .bytes()
            .filter_map(|byte| parser.push(byte).unwrap())
            .collect();
        assert_eq!(frames.len(), 1);
        assert_eq!(
            decode_chunk(serde_json::from_slice(&frames[0]).unwrap()).unwrap(),
            [
                Some(ApiEventKind::Content("\u{feff}日本語".into())),
                None,
                None
            ]
        );
    }

    #[test]
    fn parser_ignores_empty_data_and_limits_unterminated_frames() {
        let mut parser = SseParser::default();
        for byte in b"\n: comment\r\ndata:\r\n\r\ndata\n\n" {
            assert!(parser.push(*byte).unwrap().is_none());
        }
        for _ in 0 .. MAX_FRAME_BYTES {
            parser.push(b'x').unwrap();
        }
        assert_eq!(parser.push(b'x').unwrap_err().code, "format");
        let mut parser = SseParser::default();
        for _ in 0 .. MAX_FRAME_BYTES / 8 {
            for byte in b"data: x\n" {
                parser.push(*byte).unwrap();
            }
        }
        // A new oversized line also counts the multiline payload already buffered.
        let mut failed = false;
        for _ in 0 .. MAX_FRAME_BYTES {
            if parser.push(b'x').is_err() {
                failed = true;
                break;
            }
        }
        assert!(failed);
    }

    #[test]
    fn chunks_validate_shape_usage_and_sanitize_errors() {
        assert_eq!(
            decode_chunk(json!({"choices": [{"delta": {"role": "assistant", "content": ""}}]}))
                .unwrap(),
            [None, None, None]
        );
        let usage = json!({"prompt_tokens": 2, "completion_tokens": 1, "total_tokens": 3});
        assert_eq!(
            decode_chunk(json!({"choices": [], "usage": usage})).unwrap(),
            [None, None, Some(ApiEventKind::Usage(usage))]
        );
        let unavailable = json!({"prompt_tokens":null,"completion_tokens":null});
        assert_eq!(
            decode_chunk(json!({"choices":[],"usage":unavailable})).unwrap(),
            [None, None, Some(ApiEventKind::Usage(unavailable))]
        );
        for value in [
            json!([]),
            json!({}),
            json!({"choices": []}),
            json!({"choices": {}}),
            json!({"choices": [null]}),
            json!({"choices": [{"delta": {"content": 9}}]}),
            json!({"choices": [{"delta": {}, "finish_reason": 3}]}),
            json!({"usage": 3}),
            json!({"usage": {"total_tokens": -1}}),
        ] {
            assert_eq!(decode_chunk(value).unwrap_err().code, "format");
        }
        assert_eq!(
            decode_chunk(
                json!({"choices":[{"delta":{"content":"first"}},{"delta":{"content":"second"}}]})
            )
            .unwrap_err()
            .code,
            "format"
        );
        for (code, expected) in [
            ("invalid_api_key", "authentication"),
            ("rate_limit_exceeded", "rate_limit"),
            ("model_not_found", "model_not_found"),
            ("other", "api"),
        ] {
            let error =
                decode_chunk(json!({"error": {"code": code, "message": "SECRET"}})).unwrap_err();
            assert_eq!(error.code, expected);
            assert!(!error.message.contains("SECRET"));
        }
    }
}
