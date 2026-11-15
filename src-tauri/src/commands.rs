use std::{borrow::Cow, net::IpAddr, time::{Duration, Instant}};

use reqwest::{Client, Url, redirect::Policy};
use serde::{Deserialize, Serialize};
use tauri::{ipc::Channel, State};

#[derive(Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    System,
    User,
    Assistant,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Message {
    role: Role,
    content: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    reasoning: String,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct CompletionDelta {
    content: String,
    reasoning: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ReasoningEffort {
    #[serde(rename = "off")]
    Off,
    Low,
    Medium,
    High,
    Xhigh,
    Max,
}

impl ReasoningEffort {
    fn wire(&self) -> &'static str {
        match self {
            Self::Off => "none",
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
            Self::Xhigh | Self::Max => "xhigh",
        }
    }
}

#[derive(Deserialize)]
pub struct Provider {
    base_url: String,
}

#[derive(Debug, Deserialize, Serialize, PartialEq)]
pub struct Model {
    id: String,
    #[serde(default, deserialize_with = "positive_context_length", skip_serializing_if = "Option::is_none")]
    context_length: Option<u64>,
}

#[derive(Deserialize)]
struct Models {
    data: Vec<Model>,
}

fn positive_context_length<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<u64>, D::Error> {
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(value.as_u64().filter(|length| *length > 0))
}

#[derive(Deserialize)]
pub struct ChatRequest {
    model: String,
    messages: Vec<Message>,
    reasoning_effort: ReasoningEffort,
}

#[derive(Deserialize)]
pub struct ChatPayload {
    provider: Provider,
    request: ChatRequest,
}

#[derive(Serialize)]
struct WireRequest<'a> {
    model: &'a str,
    #[serde(serialize_with = "serialize_wire_messages")]
    messages: &'a [Message],
    reasoning_effort: &'a str,
    stream: bool,
    stream_options: StreamOptions,
}

fn serialize_wire_messages<S: serde::Serializer>(messages: &[Message], serializer: S) -> Result<S::Ok, S::Error> {
    #[derive(Serialize)]
    struct WireMessage<'a> {
        role: &'a Role,
        content: &'a str,
    }
    serializer.collect_seq(messages.iter().map(|message| WireMessage {
        role: &message.role,
        content: &message.content,
    }))
}

#[derive(Serialize)]
struct StreamOptions {
    include_usage: bool,
}

#[derive(Debug, Default, Serialize)]
pub struct CompletionMetrics {
    ttft_ms: Option<f64>,
    ttfb_ms: Option<f64>,
    e2e_ms: f64,
    decode_ms: Option<f64>,
    prefill_ms: Option<f64>,
    server_decode_ms: Option<f64>,
    connection_ms: Option<f64>,
    dns_ms: Option<f64>,
    tcp_ms: Option<f64>,
    tls_ms: Option<f64>,
    output_tps: Option<f64>,
    tpot_ms: Option<f64>,
    itl_mean_ms: Option<f64>,
    itl_max_ms: Option<f64>,
    itl_stddev_ms: Option<f64>,
    chunk_interval_mean_ms: Option<f64>,
    chunk_interval_max_ms: Option<f64>,
    chunk_interval_stddev_ms: Option<f64>,
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    total_tokens: Option<u64>,
    cached_tokens: Option<u64>,
    reasoning_tokens: Option<u64>,
    http_status: Option<u16>,
    finish_reason: Option<String>,
    timed_out: bool,
}

#[derive(Debug, Default, Serialize)]
pub struct MeasuredCompletion {
    message: Option<Message>,
    error: Option<String>,
    metrics: CompletionMetrics,
}

#[derive(Deserialize)]
struct StreamEvent<'a> {
    #[serde(borrow)]
    choices: Option<ChoiceList<'a>>,
    usage: Option<Usage>,
    timings: Option<ServerTimings>,
    error: Option<serde::de::IgnoredAny>,
}

struct ChoiceList<'a>(Option<StreamChoice<'a>>);

impl<'de: 'a, 'a> Deserialize<'de> for ChoiceList<'a> {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct ChoicesVisitor<'a>(std::marker::PhantomData<&'a ()>);
        impl<'de: 'a, 'a> serde::de::Visitor<'de> for ChoicesVisitor<'a> {
            type Value = ChoiceList<'a>;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("at most one completion choice")
            }

            fn visit_seq<A: serde::de::SeqAccess<'de>>(self, mut sequence: A) -> Result<Self::Value, A::Error> {
                let choice = sequence.next_element()?;
                if sequence.next_element::<serde::de::IgnoredAny>()?.is_some() {
                    return Err(serde::de::Error::custom("multiple completion choices"));
                }
                Ok(ChoiceList(choice))
            }
        }
        deserializer.deserialize_seq(ChoicesVisitor(std::marker::PhantomData))
    }
}

#[derive(Deserialize)]
#[serde(transparent)]
struct StreamText<'a>(#[serde(borrow)] Cow<'a, str>);

impl std::ops::Deref for StreamText<'_> {
    type Target = str;

    fn deref(&self) -> &str {
        &self.0
    }
}

#[derive(Deserialize)]
struct StreamChoice<'a> {
    index: u64,
    #[serde(borrow)]
    delta: Delta<'a>,
    #[serde(borrow)]
    finish_reason: Option<StreamText<'a>>,
}

#[derive(Default, Deserialize)]
struct Delta<'a> {
    #[serde(borrow)]
    role: Option<StreamText<'a>>,
    #[serde(borrow)]
    content: Option<StreamText<'a>>,
    #[serde(borrow)]
    reasoning_content: Option<StreamText<'a>>,
    #[serde(borrow)]
    reasoning: Option<StreamText<'a>>,
    #[serde(borrow)]
    refusal: Option<StreamText<'a>>,
}

#[derive(Deserialize)]
struct Usage {
    prompt_tokens: Option<u64>,
    completion_tokens: Option<u64>,
    total_tokens: Option<u64>,
    prompt_tokens_details: Option<PromptDetails>,
    completion_tokens_details: Option<CompletionDetails>,
}

#[derive(Deserialize)]
struct PromptDetails {
    cached_tokens: Option<u64>,
}

#[derive(Deserialize)]
struct CompletionDetails {
    reasoning_tokens: Option<u64>,
}

#[derive(Deserialize)]
struct ServerTimings {
    prompt_ms: Option<f64>,
    predicted_ms: Option<f64>,
}

const MAX_SSE_EVENT_BYTES: usize = 1024 * 1024;

#[derive(Default)]
struct SseDecoder {
    line: Vec<u8>,
    data: Vec<u8>,
    event_bytes: usize,
    has_data: bool,
    after_cr: bool,
}

impl SseDecoder {
    fn feed(&mut self, bytes: &[u8], mut event: impl FnMut(&[u8]) -> Result<bool, String>) -> Result<bool, String> {
        for &byte in bytes {
            if self.after_cr {
                self.after_cr = false;
                if byte == b'\n' {
                    continue;
                }
            }
            self.event_bytes += 1;
            if self.event_bytes > MAX_SSE_EVENT_BYTES {
                return Err("Chat provider returned an oversized SSE event.".into());
            }
            if byte == b'\n' || byte == b'\r' {
                self.after_cr = byte == b'\r';
                if self.line.is_empty() {
                    let done = if self.has_data { event(&self.data)? } else { false };
                    self.data.clear();
                    self.has_data = false;
                    self.event_bytes = 0;
                    if done {
                        return Ok(true);
                    }
                } else {
                    let line = std::str::from_utf8(&self.line)
                        .map_err(|_| "Chat provider returned invalid UTF-8 in its SSE stream.".to_string())?;
                    let (field, value) = line.split_once(':').unwrap_or((line, ""));
                    if field == "data" {
                        if self.has_data {
                            self.data.push(b'\n');
                        }
                        self.data.extend_from_slice(value.strip_prefix(' ').unwrap_or(value).as_bytes());
                        self.has_data = true;
                    }
                    self.line.clear();
                }
            } else {
                self.line.push(byte);
            }
        }
        Ok(false)
    }

    fn finish(&self) -> Result<(), String> {
        if !self.line.is_empty() || self.has_data {
            return Err("Chat provider returned a truncated SSE event.".into());
        }
        Ok(())
    }
}

#[derive(Default)]
struct ChunkIntervals {
    previous_ms: Option<f64>,
    count: u64,
    mean: f64,
    m2: f64,
    max: f64,
}

impl ChunkIntervals {
    fn record(&mut self, elapsed_ms: f64) {
        if let Some(previous) = self.previous_ms {
            let interval = elapsed_ms - previous;
            self.count += 1;
            let delta = interval - self.mean;
            self.mean += delta / self.count as f64;
            self.m2 += delta * (interval - self.mean);
            self.max = self.max.max(interval);
        }
        self.previous_ms = Some(elapsed_ms);
    }
}

#[derive(Default)]
struct CompletionStream {
    text: String,
    reasoning: String,
    metrics: CompletionMetrics,
    intervals: ChunkIntervals,
}

impl CompletionStream {
    fn event(&mut self, data: &[u8], elapsed_ms: f64, on_event: &mut impl FnMut(CompletionDelta) -> Result<(), String>) -> Result<bool, String> {
        if data == b"[DONE]" {
            return Ok(true);
        }
        let event: StreamEvent<'_> = serde_json::from_slice(data)
            .map_err(|_| "Chat provider returned an invalid JSON stream event.".to_string())?;
        if event.error.is_some() {
            return Err("Chat provider returned a stream error.".into());
        }
        let choice = event.choices.and_then(|choices| choices.0);
        if choice.is_none() && event.usage.is_none() && event.timings.is_none() {
            return Err("Chat provider returned no choices.".into());
        }
        if let Some(usage) = event.usage {
            if usage.prompt_tokens.is_some() { self.metrics.input_tokens = usage.prompt_tokens; }
            if usage.completion_tokens.is_some() { self.metrics.output_tokens = usage.completion_tokens; }
            if usage.total_tokens.is_some() { self.metrics.total_tokens = usage.total_tokens; }
            if let Some(details) = usage.prompt_tokens_details {
                if details.cached_tokens.is_some() { self.metrics.cached_tokens = details.cached_tokens; }
            }
            if let Some(details) = usage.completion_tokens_details {
                if details.reasoning_tokens.is_some() { self.metrics.reasoning_tokens = details.reasoning_tokens; }
            }
        }
        if let Some(timings) = event.timings {
            // Provider-reported llama.cpp timings, not client-side phase measurements.
            if let Some(value) = timings.prompt_ms.filter(|value| value.is_finite() && *value >= 0.0) {
                self.metrics.prefill_ms = Some(value);
            }
            if let Some(value) = timings.predicted_ms.filter(|value| value.is_finite() && *value >= 0.0) {
                self.metrics.server_decode_ms = Some(value);
            }
        }
        if let Some(choice) = choice {
            if choice.index != 0 {
                return Err("Chat provider returned an unexpected choice index.".into());
            }
            if choice.delta.role.as_deref().is_some_and(|role| role != "assistant") {
                return Err("Chat provider did not return an assistant message.".into());
            }
            if choice.delta.refusal.as_deref().is_some_and(|text| !text.trim().is_empty()) {
                return Err("Chat provider refused the request.".into());
            }
            if self.metrics.finish_reason.is_some() {
                return Err("Chat provider returned a choice after its finish reason.".into());
            }
            let content = choice.delta.content.as_deref().unwrap_or("");
            let reasoning = choice.delta.reasoning_content.as_deref()
                .filter(|text| !text.is_empty())
                .or(choice.delta.reasoning.as_deref()).unwrap_or("");
            if !content.is_empty() || !reasoning.is_empty() {
                self.metrics.ttft_ms.get_or_insert(elapsed_ms);
                self.intervals.record(elapsed_ms);
                self.text.push_str(content);
                self.reasoning.push_str(reasoning);
                on_event(CompletionDelta { content: content.into(), reasoning: reasoning.into() })?;
            }
            if let Some(reason) = choice.finish_reason {
                if reason.trim().is_empty() {
                    return Err("Chat provider returned an empty finish reason.".into());
                }
                self.metrics.finish_reason = Some(reason.0.into_owned());
                if self.metrics.finish_reason.as_deref() == Some("error") {
                    return Err("Chat provider returned an error finish reason.".into());
                }
            }
        }
        Ok(false)
    }

    fn validate(&self) -> Result<(), String> {
        if self.metrics.finish_reason.is_none() {
            return Err("Chat provider returned a truncated completion (missing finish_reason).".into());
        }
        if self.text.trim().is_empty() {
            return Err("Chat provider returned no assistant text (empty or tool-only response).".into());
        }
        Ok(())
    }

    fn finish(mut self, elapsed_ms: f64, error: Option<String>) -> MeasuredCompletion {
        self.metrics.e2e_ms = elapsed_ms;
        self.metrics.decode_ms = self.metrics.ttft_ms.map(|first| (elapsed_ms - first).max(0.0));
        if let (Some(tokens), Some(decode_ms)) = (self.metrics.output_tokens, self.metrics.decode_ms) {
            if tokens > 0 && decode_ms > 0.0 {
                self.metrics.output_tps = Some(tokens as f64 * 1000.0 / decode_ms);
            }
            if tokens > 1 {
                // Derived time per output token; SSE deltas do not expose exact token ITL.
                self.metrics.tpot_ms = Some(decode_ms / (tokens - 1) as f64);
            }
        }
        if self.intervals.count > 0 {
            self.metrics.chunk_interval_mean_ms = Some(self.intervals.mean);
            self.metrics.chunk_interval_max_ms = Some(self.intervals.max);
            self.metrics.chunk_interval_stddev_ms =
                Some((self.intervals.m2 / self.intervals.count as f64).max(0.0).sqrt());
        }
        MeasuredCompletion {
            message: (!self.text.is_empty() || !self.reasoning.is_empty()).then_some(Message {
                role: Role::Assistant, content: self.text, reasoning: self.reasoning,
            }),
            error,
            metrics: self.metrics,
        }
    }
}

pub fn http_client() -> Result<Client, reqwest::Error> {
    Client::builder()
        .timeout(Duration::from_secs(120))
        .redirect(Policy::none())
        .build()
}

fn endpoint(base: &str, suffix: &str) -> Result<Url, String> {
    let invalid = || {
        "Invalid provider URL: use HTTP on loopback or HTTPS, without credentials, query, or fragment.".to_string()
    };
    let mut url = Url::parse(base).map_err(|_| invalid())?;
    let has_userinfo = base
        .split_once("://")
        .map(|(_, rest)| {
            rest.split(['/', '?', '#'])
                .next()
                .unwrap_or("")
                .contains('@')
        })
        .unwrap_or(false);
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || has_userinfo
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(invalid());
    }
    let host = url.host_str().unwrap_or("").trim_matches(['[', ']']);
    let loopback = host.eq_ignore_ascii_case("localhost")
        || host.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback());
    if url.scheme() == "http" && !loopback {
        return Err(invalid());
    }
    let path = format!("{}/{}", url.path().trim_end_matches('/'), suffix);
    url.set_path(&path);
    Ok(url)
}

async fn complete(client: &Client, payload: ChatPayload, mut on_event: impl FnMut(CompletionDelta) -> Result<(), String>) -> MeasuredCompletion {
    let url = match endpoint(&payload.provider.base_url, "chat/completions") {
        Ok(url) => url,
        Err(error) => return MeasuredCompletion { error: Some(error), ..Default::default() },
    };
    let request = payload.request;
    if request.model.trim().is_empty()
        || request.messages.is_empty()
        || request.messages.iter().any(|message| message.content.trim().is_empty())
    {
        return MeasuredCompletion {
            error: Some("A nonblank model and at least one message with nonblank content are required.".into()),
            ..Default::default()
        };
    }
    // Unauthenticated endpoints only: never attach API keys or other credentials.
    let request = client.post(url).json(&WireRequest {
        model: &request.model,
        messages: &request.messages,
        reasoning_effort: request.reasoning_effort.wire(),
        stream: true,
        stream_options: StreamOptions { include_usage: true },
    });
    let mut stream = CompletionStream::default();
    let started = Instant::now();
    let mut response = match request.send().await {
        Ok(response) => response,
        Err(error) => {
            stream.metrics.timed_out = error.is_timeout();
            let message = if error.is_timeout() { "Chat request timed out." } else { "Could not reach the chat provider." };
            return stream.finish(started.elapsed().as_secs_f64() * 1000.0, Some(message.into()));
        }
    };
    let status = response.status();
    stream.metrics.http_status = Some(status.as_u16());
    let mut decoder = SseDecoder::default();
    let (e2e_ms, error) = loop {
        match response.chunk().await {
            Ok(Some(bytes)) => {
                if bytes.is_empty() { continue; }
                let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;
                stream.metrics.ttfb_ms.get_or_insert(elapsed_ms);
                if !status.is_success() { continue; }
                match decoder.feed(&bytes, |data| stream.event(data, elapsed_ms, &mut on_event)) {
                    Ok(true) => break (elapsed_ms, stream.validate().err()),
                    Ok(false) => {}
                    Err(error) => break (elapsed_ms, Some(error)),
                }
            }
            Ok(None) => {
                let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;
                let error = if status.is_success() {
                    decoder.finish().and_then(|()| stream.validate()).err()
                } else {
                    Some(format!("Chat provider returned HTTP {}.", status.as_u16()))
                };
                break (elapsed_ms, error);
            }
            Err(error) => {
                stream.metrics.timed_out = error.is_timeout();
                let message = if error.is_timeout() { "Chat response body timed out." } else { "Could not read the chat response body." };
                break (started.elapsed().as_secs_f64() * 1000.0, Some(if status.is_success() {
                    message.into()
                } else {
                    format!("Chat provider returned HTTP {}. {message}", status.as_u16())
                }));
            }
        }
    };
    stream.finish(e2e_ms, error)
}

async fn fetch_models(client: &Client, provider: Provider) -> Result<Vec<Model>, String> {
    let url = endpoint(&provider.base_url, "models")?;
    let response = client.get(url).send().await.map_err(|error| {
        if error.is_timeout() {
            "Model list request timed out.".to_string()
        } else {
            "Could not reach the model provider.".to_string()
        }
    })?;
    if !response.status().is_success() {
        return Err(format!(
            "Model provider returned HTTP {}.",
            response.status().as_u16()
        ));
    }
    let models: Models = response
        .json()
        .await
        .map_err(|_| "Model provider returned an invalid JSON model list.".to_string())?;
    if models.data.iter().any(|model| model.id.trim().is_empty()) {
        return Err("Model provider returned a blank model ID.".into());
    }
    Ok(models.data)
}

#[tauri::command]
pub async fn chat_completion(
    client: State<'_, Client>,
    payload: ChatPayload,
    on_event: Channel<CompletionDelta>,
) -> Result<MeasuredCompletion, String> {
    Ok(complete(client.inner(), payload, |delta| {
        on_event.send(delta).map_err(|_| "Could not deliver the chat response to the UI.".into())
    }).await)
}

#[tauri::command]
pub async fn list_models(
    client: State<'_, Client>,
    provider: Provider,
) -> Result<Vec<Model>, String> {
    fetch_models(client.inner(), provider).await
}

#[cfg(test)]
mod tests {
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    use super::*;

    async fn server(status: &str, body: &str) -> (String, tokio::task::JoinHandle<String>) {
        stream_server(status, vec![(Duration::ZERO, body.as_bytes().to_vec())], 0).await
    }

    async fn stream_server(
        status: &str,
        chunks: Vec<(Duration, Vec<u8>)>,
        missing_bytes: usize,
    ) -> (String, tokio::task::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}/v1/", listener.local_addr().unwrap());
        let response = format!(
            "HTTP/1.1 {status}\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            chunks.iter().map(|(_, bytes)| bytes.len()).sum::<usize>() + missing_bytes
        );
        let task = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            socket.set_nodelay(true).unwrap();
            let mut bytes = Vec::new();
            let mut buffer = [0; 4096];
            loop {
                let count = socket.read(&mut buffer).await.unwrap();
                assert!(count > 0, "request ended before its body");
                bytes.extend_from_slice(&buffer[.. count]);
                if let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&bytes[.. end]);
                    let length: usize = headers
                        .lines()
                        .find_map(|line| {
                            let (name, value) = line.split_once(':')?;
                            name.eq_ignore_ascii_case("content-length")
                                .then(|| value.trim().parse().unwrap())
                        })
                        .unwrap_or(0);
                    if bytes.len() >= end + 4 + length {
                        break;
                    }
                }
            }
            socket.write_all(response.as_bytes()).await.unwrap();
            for (delay, chunk) in chunks {
                tokio::time::sleep(delay).await;
                if socket.write_all(&chunk).await.is_err() { break; }
            }
            String::from_utf8(bytes).unwrap()
        });
        (base, task)
    }

    fn event(delta: serde_json::Value, finish_reason: Option<&str>) -> String {
        format!("data: {}\n\n", serde_json::json!({
            "choices": [{"index": 0, "delta": delta, "finish_reason": finish_reason}]
        }))
    }

    fn completion(text: &str) -> String {
        format!("{}data: [DONE]\n\n", event(serde_json::json!({"role": "assistant", "content": text}), Some("stop")))
    }

    fn payload(base_url: String, effort: &str) -> ChatPayload {
        serde_json::from_value(serde_json::json!({
            "provider": {"base_url": base_url},
            "request": {"model": "local-model", "messages": [{"role": "user", "content": "Hello"}], "reasoning_effort": effort}
        })).unwrap()
    }

    #[tokio::test]
    async fn delivers_deltas_before_http_completion() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}/v1", listener.local_addr().unwrap());
        let (emitted, observed) = tokio::sync::oneshot::channel();
        let first = event(serde_json::json!({"reasoning_content":"Thinking"}), None);
        let last = completion("Answer");
        let task = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            let mut buffer = [0; 4096];
            loop {
                let count = socket.read(&mut buffer).await.unwrap();
                assert!(count > 0);
                request.extend_from_slice(&buffer[..count]);
                if let Some(end) = request.windows(4).position(|part| part == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&request[..end]);
                    let length: usize = headers.lines().find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        name.eq_ignore_ascii_case("content-length").then(|| value.trim().parse().unwrap())
                    }).unwrap_or(0);
                    if request.len() >= end + 4 + length { break; }
                }
            }
            socket.write_all(format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{first}",
                first.len() + last.len(),
            ).as_bytes()).await.unwrap();
            observed.await.unwrap();
            socket.write_all(last.as_bytes()).await.unwrap();
        });
        let mut emitted = Some(emitted);
        let mut deltas = Vec::new();
        let result = tokio::time::timeout(Duration::from_secs(5), complete(
            &http_client().unwrap(), payload(base, "off"), |delta| {
                if delta.reasoning == "Thinking" {
                    emitted.take().unwrap().send(()).unwrap();
                }
                deltas.push(delta);
                Ok(())
            },
        )).await.unwrap();
        task.await.unwrap();
        assert!(result.error.is_none(), "{:?}", result.error);
        assert_eq!(deltas, vec![
            CompletionDelta { content: "".into(), reasoning: "Thinking".into() },
            CompletionDelta { content: "Answer".into(), reasoning: "".into() },
        ]);
        let reply = result.message.unwrap();
        assert_eq!(reply.content, "Answer");
        assert_eq!(reply.reasoning, "Thinking");
    }

    #[test]
    fn streams_fragmented_reasoning_and_counts_each_event_once() {
        let mut decoder = SseDecoder::default();
        let mut stream = CompletionStream::default();
        let mut deltas = Vec::new();
        for (elapsed, delta, finish) in [
            (5.0, serde_json::json!({"role":"assistant","content":""}), None),
            (10.0, serde_json::json!({"reasoning_content":"Ré"}), None),
            (30.0, serde_json::json!({"content":"Hi","reasoning":"ason"}), None),
            (40.0, serde_json::json!({}), Some("stop")),
        ] {
            for byte in event(delta, finish).replace('\n', "\r\n").as_bytes() {
                assert!(!decoder.feed(std::slice::from_ref(byte), |data| stream.event(
                    data, elapsed, &mut |delta| { deltas.push(delta); Ok(()) },
                )).unwrap());
            }
        }
        assert_eq!(deltas, vec![
            CompletionDelta { content: "".into(), reasoning: "Ré".into() },
            CompletionDelta { content: "Hi".into(), reasoning: "ason".into() },
        ]);
        assert_eq!(stream.metrics.ttft_ms, Some(10.0));
        assert_eq!(stream.intervals.count, 1);
        assert_eq!(stream.intervals.mean, 20.0);
        assert!(stream.validate().is_ok());
        let reply = stream.finish(50.0, None).message.unwrap();
        assert_eq!(reply.reasoning, "Réason");
        assert_eq!(serde_json::to_value(reply).unwrap()["reasoning"], "Réason");
    }

    #[test]
    fn retains_emitted_deltas_on_stream_errors() {
        for (tail, expected) in [
            ("data: broken\n\n".into(), "invalid JSON"),
            ("data: {\"error\":{\"message\":\"secret\"}}\n\n".into(), "stream error"),
            (event(serde_json::json!({"refusal":"secret","content":"not emitted"}), None), "refused"),
            ("data: {\"choices\":".into(), "truncated SSE"),
            (String::new(), "missing finish_reason"),
        ] {
            let mut decoder = SseDecoder::default();
            let mut stream = CompletionStream::default();
            let mut deltas = Vec::new();
            let mut emit = |delta| { deltas.push(delta); Ok(()) };
            decoder.feed(event(serde_json::json!({"content":"partial","reasoning":"why"}), None).as_bytes(),
                |data| stream.event(data, 10.0, &mut emit)).unwrap();
            let error = decoder.feed(tail.as_bytes(), |data| stream.event(data, 20.0, &mut emit))
                .and_then(|_| decoder.finish())
                .and_then(|()| stream.validate()).unwrap_err();
            assert!(error.contains(expected), "{error}");
            assert_eq!(deltas, vec![CompletionDelta { content: "partial".into(), reasoning: "why".into() }]);
            let reply = stream.finish(30.0, Some(error)).message.unwrap();
            assert_eq!(reply.content, "partial");
            assert_eq!(reply.reasoning, "why");
        }
    }

    #[test]
    fn omits_reasoning_from_request_messages_and_empty_replies() {
        let request = ChatRequest {
            model: "local".into(),
            messages: vec![Message { role: Role::Assistant, content: "Hi".into(), reasoning: "private metadata".into() }],
            reasoning_effort: ReasoningEffort::Off,
        };
        let wire = serde_json::to_value(WireRequest {
            model: &request.model, messages: &request.messages,
            reasoning_effort: "none", stream: true, stream_options: StreamOptions { include_usage: true },
        }).unwrap();
        assert_eq!(wire["messages"], serde_json::json!([{"role":"assistant","content":"Hi"}]));
        let reply = Message { role: Role::Assistant, content: "Hi".into(), reasoning: String::new() };
        assert!(serde_json::to_value(reply).unwrap().get("reasoning").is_none());
    }

    #[tokio::test]
    async fn posts_completion_and_maps_effort() {
        let client = http_client().unwrap();
        for (effort, wire) in [
            ("off", "none"),
            ("low", "low"),
            ("medium", "medium"),
            ("high", "high"),
            ("xhigh", "xhigh"),
            ("max", "xhigh"),
        ] {
            let (base, task) = server(
                "200 OK",
                &completion("Hi"),
            )
            .await;
            let result = complete(&client, payload(base, effort), |_| Ok(())).await;
            assert!(result.error.is_none(), "{:?}", result.error);
            let reply = result.message.unwrap();
            assert_eq!(result.metrics.http_status, Some(200));
            assert_eq!(result.metrics.finish_reason.as_deref(), Some("stop"));
            assert_eq!(result.metrics.input_tokens, None);
            assert_eq!(result.metrics.output_tokens, None);
            assert_eq!(result.metrics.output_tps, None);
            assert_eq!(result.metrics.tpot_ms, None);
            assert_eq!(reply.role, Role::Assistant);
            assert_eq!(reply.content, "Hi");
            let request = task.await.unwrap();
            assert!(request.starts_with("POST /v1/chat/completions HTTP/1.1\r\n"));
            let body: serde_json::Value =
                serde_json::from_str(request.split_once("\r\n\r\n").unwrap().1).unwrap();
            assert_eq!(
                body,
                serde_json::json!({
                    "model": "local-model", "messages": [{"role": "user", "content": "Hello"}],
                    "reasoning_effort": wire, "stream": true, "stream_options": {"include_usage": true}
                })
            );
        }
    }

    #[tokio::test]
    async fn rejects_provider_errors_and_invalid_replies() {
        let client = http_client().unwrap();
        for (status, body, expected) in [
            ("401 Unauthorized", "secret provider detail".into(), "HTTP 401"),
            ("429 Too Many Requests", "secret provider detail".into(), "HTTP 429"),
            ("500 Internal Server Error", "secret provider detail".into(), "HTTP 500"),
            ("302 Found", String::new(), "HTTP 302"),
            ("200 OK", "data: not json\n\n".into(), "invalid JSON"),
            ("200 OK", "data: {\"choices\":[]}\n\n".into(), "no choices"),
            ("200 OK", event(serde_json::json!({"role":"assistant","content":null,"tool_calls":[]}), Some("stop")), "no assistant text"),
            ("200 OK", completion(" "), "no assistant text"),
            ("200 OK", event(serde_json::json!({"role":"assistant","refusal":"secret refusal"}), None), "refused"),
            ("200 OK", event(serde_json::json!({"role":"user","content":"Hi"}), None), "not return an assistant"),
            ("200 OK", event(serde_json::json!({"content":"partial"}), None), "missing finish_reason"),
            ("200 OK", "data: [DONE]\n\n".into(), "missing finish_reason"),
            ("200 OK", "data: {\"choices\":".into(), "truncated SSE"),
            ("200 OK", "data: {}\n\n".into(), "no choices"),
            ("200 OK", "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":7}}]}\n\n".into(), "invalid JSON"),
            ("200 OK", "data: {\"choices\":[{\"index\":1,\"delta\":{\"content\":\"Hi\"},\"finish_reason\":\"stop\"}]}\n\n".into(), "choice index"),
            ("200 OK", format!("{}data: broken\n\n", event(serde_json::json!({"content":"partial"}), None)), "invalid JSON"),
            ("200 OK", "data: {\"error\":{\"message\":\"secret detail\"}}\n\n".into(), "stream error"),
            ("200 OK", event(serde_json::json!({"content":"partial"}), Some("error")), "error finish reason"),
            ("200 OK", format!("{}data: broken\n\n", event(serde_json::json!({"content":"partial"}), Some("stop"))), "invalid JSON"),
        ] {
            let (base, task) = server(status, &body).await;
            let result = complete(&client, payload(base, "off"), |_| Ok(())).await;
            assert_eq!(result.metrics.http_status, Some(status[..3].parse().unwrap()));
            let error = result.error.unwrap();
            assert!(error.contains(expected), "{error}");
            assert!(!error.contains("secret"));
            task.await.unwrap();
        }
    }

    #[tokio::test]
    async fn measures_delayed_fragmented_sse_and_provider_usage() {
        let first = event(serde_json::json!({"content":"Hé"}), None).replace('\n', "\r\n");
        let split = first.as_bytes().iter().position(|byte| *byte == 0xc3).unwrap() + 1;
        let delay = Duration::from_millis(40);
        let (base, task) = stream_server("200 OK", vec![
            (delay, b": keepalive\r\n\r\n".to_vec()),
            (delay, b"data: {\"choices\":[\r\ndata: {\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"\"},\"finish_reason\":null}]}\r\n\r\n".to_vec()),
            (delay, first.as_bytes()[..split].to_vec()),
            (delay, first.as_bytes()[split..].to_vec()),
            (delay, event(serde_json::json!({"content":"llo"}), None).into_bytes()),
            (delay, b"data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],\"timings\":{\"prompt_ms\":12.5,\"predicted_ms\":47}}\n\n".to_vec()),
            (delay, b"data: {\"choices\":[],\"usage\":{\"prompt_tokens\":7,\"completion_tokens\":4,\"total_tokens\":11,\"prompt_tokens_details\":{\"cached_tokens\":0},\"completion_tokens_details\":{\"reasoning_tokens\":2}}}\n\n".to_vec()),
            (delay, b"data: [DONE]\n\n".to_vec()),
        ], 0).await;
        let result = complete(&http_client().unwrap(), payload(base, "off"), |_| Ok(())).await;
        assert!(result.error.is_none(), "{:?}", result.error);
        assert_eq!(result.message.unwrap().content, "Héllo");
        let metrics = result.metrics;
        assert!(metrics.ttfb_ms.unwrap() >= 20.0);
        assert!(metrics.ttft_ms.unwrap() >= metrics.ttfb_ms.unwrap() + 70.0);
        assert!(metrics.e2e_ms >= metrics.ttft_ms.unwrap() + 90.0);
        assert_eq!(metrics.decode_ms, Some(metrics.e2e_ms - metrics.ttft_ms.unwrap()));
        assert_eq!(metrics.input_tokens, Some(7));
        assert_eq!(metrics.output_tokens, Some(4));
        assert_eq!(metrics.total_tokens, Some(11));
        assert_eq!(metrics.cached_tokens, Some(0));
        assert_eq!(metrics.reasoning_tokens, Some(2));
        assert_eq!(metrics.prefill_ms, Some(12.5));
        assert_eq!(metrics.server_decode_ms, Some(47.0));
        assert_eq!(metrics.output_tps, Some(4000.0 / metrics.decode_ms.unwrap()));
        assert_eq!(metrics.tpot_ms, Some(metrics.decode_ms.unwrap() / 3.0));
        assert!(metrics.chunk_interval_mean_ms.unwrap() >= 20.0);
        assert_eq!(metrics.chunk_interval_max_ms, metrics.chunk_interval_mean_ms);
        assert_eq!(metrics.chunk_interval_stddev_ms, Some(0.0));
        let serialized = serde_json::to_value(metrics).unwrap();
        for name in ["connection_ms", "dns_ms", "tcp_ms", "tls_ms", "itl_mean_ms", "itl_max_ms", "itl_stddev_ms"] {
            assert!(serialized[name].is_null(), "{name}");
        }
        let request = task.await.unwrap();
        assert!(!request.to_ascii_lowercase().contains("authorization:"));
    }

    #[tokio::test]
    async fn accepts_clean_finished_stream_and_retains_zero_usage() {
        let body = format!("{}data: {{\"usage\":{{\"prompt_tokens\":0,\"completion_tokens\":0,\"total_tokens\":0}}}}\n\n",
            event(serde_json::json!({"content":"Hi"}), Some("length")));
        let (base, task) = server("200 OK", &body).await;
        let result = complete(&http_client().unwrap(), payload(base, "off"), |_| Ok(())).await;
        assert!(result.error.is_none(), "{:?}", result.error);
        assert_eq!(result.metrics.finish_reason.as_deref(), Some("length"));
        assert_eq!(result.metrics.input_tokens, Some(0));
        assert_eq!(result.metrics.output_tokens, Some(0));
        assert_eq!(result.metrics.total_tokens, Some(0));
        assert_eq!(result.metrics.output_tps, None);
        assert_eq!(result.metrics.tpot_ms, None);
        assert_eq!(result.metrics.cached_tokens, None);
        assert_eq!(result.metrics.reasoning_tokens, None);
        assert_eq!(result.metrics.chunk_interval_mean_ms, None);
        task.await.unwrap();
    }

    #[tokio::test]
    async fn preserves_partial_text_on_malformed_and_incomplete_bodies() {
        let first = event(serde_json::json!({"content":"partial"}), None);
        for (tail, missing_bytes) in [
            (b"data: broken\n\n".as_slice(), 0),
            (b"data: {\"choices\":".as_slice(), 0),
            (b"".as_slice(), 100),
            (b"data: \xff\n\n".as_slice(), 0),
        ] {
            let (base, task) = stream_server("200 OK", vec![
                (Duration::ZERO, first.as_bytes().to_vec()),
                (Duration::from_millis(10), tail.to_vec()),
            ], missing_bytes).await;
            let mut deltas = Vec::new();
            let result = complete(&http_client().unwrap(), payload(base, "off"), |delta| {
                deltas.push(delta);
                Ok(())
            }).await;
            assert_eq!(deltas, vec![CompletionDelta { content: "partial".into(), reasoning: "".into() }]);
            assert!(result.error.is_some());
            assert_eq!(result.message.unwrap().content, "partial");
            assert_eq!(result.metrics.http_status, Some(200));
            assert!(!result.metrics.timed_out);
            assert!(result.metrics.ttft_ms.is_some());
            assert_eq!(result.metrics.output_tokens, None);
            task.await.unwrap();
        }
    }

    #[tokio::test]
    async fn records_body_timeout_and_connection_failure() {
        let first = event(serde_json::json!({"content":"partial"}), None);
        let (base, task) = stream_server("200 OK", vec![
            (Duration::ZERO, first.into_bytes()),
            (Duration::from_millis(250), completion("late").into_bytes()),
        ], 0).await;
        let client = Client::builder().timeout(Duration::from_millis(100)).build().unwrap();
        let result = complete(&client, payload(base, "off"), |_| Ok(())).await;
        assert!(result.error.unwrap().contains("timed out"));
        assert!(result.metrics.timed_out);
        assert_eq!(result.metrics.http_status, Some(200));
        assert_eq!(result.message.unwrap().content, "partial");
        task.await.unwrap();

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}/v1", listener.local_addr().unwrap());
        drop(listener);
        let result = complete(&http_client().unwrap(), payload(base, "off"), |_| Ok(())).await;
        assert!(result.error.unwrap().contains("Could not reach"));
        assert_eq!(result.metrics.http_status, None);
        assert_eq!(result.metrics.ttfb_ms, None);
        assert_eq!(result.metrics.ttft_ms, None);
        assert!(result.message.is_none());
    }

    #[test]
    fn bounds_sse_events_and_handles_every_byte_fragment() {
        let body = completion("Hé\n世界");
        let mut decoder = SseDecoder::default();
        let mut stream = CompletionStream::default();
        let mut done = false;
        for byte in body.as_bytes() {
            done |= decoder.feed(std::slice::from_ref(byte), |data| stream.event(data, 1.0, &mut |_| Ok(()))).unwrap();
        }
        assert!(done);
        assert!(stream.validate().is_ok());
        assert_eq!(stream.text, "Hé\n世界");
        let mut decoder = SseDecoder::default();
        let error = decoder.feed(&vec![b'x'; MAX_SSE_EVENT_BYTES + 1], |_| Ok(false)).unwrap_err();
        assert!(error.contains("oversized"));
        assert!(decoder.line.len() <= MAX_SSE_EVENT_BYTES);
    }

    #[test]
    fn derives_tpot_without_inventing_token_counts_or_itl() {
        for tokens in [None, Some(0), Some(1), Some(2)] {
            for end_ms in [10.0, 30.0] {
                let stream = CompletionStream {
                    metrics: CompletionMetrics { ttft_ms: Some(10.0), output_tokens: tokens, ..Default::default() },
                    ..Default::default()
                };
                let metrics = stream.finish(end_ms, None).metrics;
                assert_eq!(metrics.decode_ms, Some(end_ms - 10.0));
                assert_eq!(metrics.tpot_ms, tokens.filter(|count| *count > 1).map(|count| (end_ms - 10.0) / (count - 1) as f64));
                assert_eq!(metrics.output_tps, tokens.filter(|count| *count > 0 && end_ms > 10.0).map(|count| count as f64 * 1000.0 / (end_ms - 10.0)));
                assert_eq!(metrics.itl_mean_ms, None);
            }
        }
        let mut intervals = ChunkIntervals::default();
        for elapsed in [0.0, 10.0, 30.0, 60.0] { intervals.record(elapsed); }
        assert_eq!(intervals.count, 3);
        assert_eq!(intervals.mean, 20.0);
        assert_eq!(intervals.max, 30.0);
        assert_eq!(intervals.m2 / intervals.count as f64, 200.0 / 3.0);
    }

    #[tokio::test]
    async fn ignores_invalid_optional_model_context_lengths() {
        for value in ["null", "0", "-1", "2.5", "\"32768\"", "{}", "[]", "true"] {
            let body = format!("{{\"data\":[{{\"id\":\"local\",\"context_length\":{value}}}]}}");
            let (base_url, task) = server("200 OK", &body).await;
            let models = fetch_models(&http_client().unwrap(), Provider { base_url }).await.unwrap();
            assert_eq!(models[0].context_length, None, "{value}");
            task.await.unwrap();
        }
    }

    #[tokio::test]
    async fn gets_provider_models() {
        let (base_url, task) = server(
            "200 OK",
            r#"{"data":[{"id":"Qwen/Qwen3-8B","object":"model","context_length":32768},{"id":"llama3.2:latest"}]}"#,
        )
        .await;
        let models = fetch_models(&http_client().unwrap(), Provider { base_url })
            .await
            .unwrap();
        assert_eq!(
            models,
            vec![
                Model {
                    id: "Qwen/Qwen3-8B".into(),
                    context_length: Some(32768),
                },
                Model {
                    id: "llama3.2:latest".into(),
                    context_length: None,
                },
            ]
        );
        let request = task.await.unwrap();
        assert!(request.starts_with("GET /v1/models HTTP/1.1\r\n"));
        assert!(!request.to_ascii_lowercase().contains("authorization:"));
        assert_eq!(request.split_once("\r\n\r\n").unwrap().1, "");
    }

    #[tokio::test]
    async fn accepts_empty_model_list() {
        let (base_url, task) = server("200 OK", r#"{"data":[]}"#).await;
        let models = fetch_models(&http_client().unwrap(), Provider { base_url })
            .await
            .unwrap();
        assert!(models.is_empty());
        task.await.unwrap();
    }

    #[tokio::test]
    async fn rejects_model_errors_and_invalid_ids() {
        let client = http_client().unwrap();
        for (status, body, expected) in [
            ("401 Unauthorized", "secret provider detail", "HTTP 401"),
            (
                "500 Internal Server Error",
                "secret provider detail",
                "HTTP 500",
            ),
            ("302 Found", "", "HTTP 302"),
            ("200 OK", "not json", "invalid JSON"),
            ("200 OK", r#"{}"#, "invalid JSON"),
            ("200 OK", r#"{"data":null}"#, "invalid JSON"),
            ("200 OK", r#"{"data":[{}]}"#, "invalid JSON"),
            ("200 OK", r#"{"data":[{"id":7}]}"#, "invalid JSON"),
            ("200 OK", r#"{"data":[{"id":null}]}"#, "invalid JSON"),
            ("200 OK", r#"{"data":[{"id":""}]}"#, "blank model ID"),
            ("200 OK", r#"{"data":[{"id":" \n\t"}]}"#, "blank model ID"),
            (
                "200 OK",
                r#"{"data":[{"id":"valid"},{"id":" "}]}"#,
                "blank model ID",
            ),
        ] {
            let (base_url, task) = server(status, body).await;
            let error = fetch_models(&client, Provider { base_url })
                .await
                .unwrap_err();
            assert!(error.contains(expected), "{error}");
            assert!(!error.contains("secret"));
            task.await.unwrap();
        }
    }

    #[test]
    fn validates_provider_urls() {
        for base in [
            "http://example.com/v1",
            "ftp://localhost/v1",
            "https://user:secret@example.com",
            "https://@example.com",
            "https://example.com?key=secret",
            "https://example.com/#fragment",
            "not a url",
        ] {
            for suffix in ["chat/completions", "models"] {
                assert!(endpoint(base, suffix).is_err(), "{base}");
            }
        }
        for base in [
            "http://localhost:1234/v1",
            "http://127.0.0.1/v1",
            "http://[::1]/v1",
            "https://example.com/v1",
        ] {
            for suffix in ["chat/completions", "models"] {
                assert_eq!(
                    endpoint(base, suffix).unwrap().path(),
                    format!("/v1/{suffix}")
                );
            }
        }
    }

    #[tokio::test]
    async fn rejects_blank_request_fields() {
        let client = http_client().unwrap();
        for field in ["model", "messages", "content"] {
            let mut request = payload("http://localhost:1/v1".into(), "off");
            match field {
                "model" => request.request.model = " ".into(),
                "messages" => request.request.messages.clear(),
                _ => request.request.messages[0].content = " ".into(),
            }
            assert!(
                complete(&client, request, |_| Ok(()))
                    .await
                    .error.unwrap()
                    .contains("nonblank")
            );
        }
    }
}
