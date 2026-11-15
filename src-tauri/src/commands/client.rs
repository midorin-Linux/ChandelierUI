use std::{
    net::IpAddr,
    time::{Duration, Instant},
};

use reqwest::{Client, Url, redirect::Policy};

use super::{
    metrics::MeasuredCompletion,
    sse::SseDecoder,
    stream::CompletionStream,
    types::{ChatPayload, CompletionDelta, Model, Models, Provider, StreamOptions, WireRequest},
};

pub fn http_client() -> Result<Client, reqwest::Error> {
    Client::builder()
        .timeout(Duration::from_secs(120))
        .redirect(Policy::none())
        .build()
}

pub(super) fn endpoint(base: &str, suffix: &str) -> Result<Url, String> {
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

pub(super) async fn complete(
    client: &Client,
    payload: ChatPayload,
    mut on_event: impl FnMut(CompletionDelta) -> Result<(), String>,
) -> MeasuredCompletion {
    let url = match endpoint(&payload.provider.base_url, "chat/completions") {
        Ok(url) => url,
        Err(error) => {
            return MeasuredCompletion {
                error: Some(error),
                ..Default::default()
            };
        }
    };
    let request = payload.request;
    if request.model.trim().is_empty()
        || request.messages.is_empty()
        || request
            .messages
            .iter()
            .any(|message| message.content.trim().is_empty())
    {
        return MeasuredCompletion {
            error: Some(
                "A nonblank model and at least one message with nonblank content are required."
                    .into(),
            ),
            ..Default::default()
        };
    }
    // Unauthenticated endpoints only: never attach API keys or other credentials.
    let request = client.post(url).json(&WireRequest {
        model: &request.model,
        messages: &request.messages,
        reasoning_effort: request.reasoning_effort.wire(),
        stream: true,
        stream_options: StreamOptions {
            include_usage: true,
        },
    });
    let mut stream = CompletionStream::default();
    let started = Instant::now();
    let mut response = match request.send().await {
        Ok(response) => response,
        Err(error) => {
            stream.metrics.timed_out = error.is_timeout();
            let message = if error.is_timeout() {
                "Chat request timed out."
            } else {
                "Could not reach the chat provider."
            };
            return stream.finish(
                started.elapsed().as_secs_f64() * 1000.0,
                Some(message.into()),
            );
        }
    };
    let status = response.status();
    stream.metrics.http_status = Some(status.as_u16());
    let mut decoder = SseDecoder::default();
    let (e2e_ms, error) = loop {
        match response.chunk().await {
            Ok(Some(bytes)) => {
                if bytes.is_empty() {
                    continue;
                }
                let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;
                stream.metrics.ttfb_ms.get_or_insert(elapsed_ms);
                if !status.is_success() {
                    continue;
                }
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
                let message = if error.is_timeout() {
                    "Chat response body timed out."
                } else {
                    "Could not read the chat response body."
                };
                break (
                    started.elapsed().as_secs_f64() * 1000.0,
                    Some(if status.is_success() {
                        message.into()
                    } else {
                        format!("Chat provider returned HTTP {}. {message}", status.as_u16())
                    }),
                );
            }
        }
    };
    stream.finish(e2e_ms, error)
}

pub(super) async fn fetch_models(
    client: &Client,
    provider: Provider,
) -> Result<Vec<Model>, String> {
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
