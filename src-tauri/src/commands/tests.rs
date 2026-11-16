use std::time::Duration;

use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

use super::{
    client::{
        complete, complete_cancellable, endpoint, fetch_models, http_client,
        http_client_with_timeouts,
    },
    metrics::{ChunkIntervals, CompletionMetrics},
    sse::{MAX_SSE_EVENT_BYTES, SseDecoder},
    stream::CompletionStream,
    types::{
        ChatPayload, ChatRequest, CompletionDelta, Message, Model, Provider, ReasoningEffort, Role,
        StreamOptions, WireRequest,
    },
};

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
            if socket.write_all(&chunk).await.is_err() {
                break;
            }
        }
        String::from_utf8(bytes).unwrap()
    });
    (base, task)
}

fn event(delta: serde_json::Value, finish_reason: Option<&str>) -> String {
    format!(
        "data: {}\n\n",
        serde_json::json!({
            "choices": [{"index": 0, "delta": delta, "finish_reason": finish_reason}]
        })
    )
}

fn completion(text: &str) -> String {
    format!(
        "{}data: [DONE]\n\n",
        event(
            serde_json::json!({"role": "assistant", "content": text}),
            Some("stop")
        )
    )
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
            request.extend_from_slice(&buffer[.. count]);
            if let Some(end) = request.windows(4).position(|part| part == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&request[.. end]);
                let length: usize = headers
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse().unwrap())
                    })
                    .unwrap_or(0);
                if request.len() >= end + 4 + length {
                    break;
                }
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
    let result = tokio::time::timeout(
        Duration::from_secs(5),
        complete(&http_client().unwrap(), payload(base, "off"), |delta| {
            if delta.reasoning == "Thinking" {
                emitted.take().unwrap().send(()).unwrap();
            }
            deltas.push(delta);
            Ok(())
        }),
    )
    .await
    .unwrap();
    task.await.unwrap();
    assert!(result.error.is_none(), "{:?}", result.error);
    assert_eq!(
        deltas,
        vec![
            CompletionDelta {
                content: "".into(),
                reasoning: "Thinking".into()
            },
            CompletionDelta {
                content: "Answer".into(),
                reasoning: "".into()
            },
        ]
    );
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
        (
            5.0,
            serde_json::json!({"role":"assistant","content":""}),
            None,
        ),
        (10.0, serde_json::json!({"reasoning_content":"Ré"}), None),
        (
            30.0,
            serde_json::json!({"content":"Hi","reasoning":"ason"}),
            None,
        ),
        (40.0, serde_json::json!({}), Some("stop")),
    ] {
        for byte in event(delta, finish).replace('\n', "\r\n").as_bytes() {
            assert!(
                !decoder
                    .feed(std::slice::from_ref(byte), |data| stream.event(
                        data,
                        elapsed,
                        &mut |delta| {
                            deltas.push(delta);
                            Ok(())
                        },
                    ))
                    .unwrap()
            );
        }
    }
    assert_eq!(
        deltas,
        vec![
            CompletionDelta {
                content: "".into(),
                reasoning: "Ré".into()
            },
            CompletionDelta {
                content: "Hi".into(),
                reasoning: "ason".into()
            },
        ]
    );
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
        (
            "data: {\"error\":{\"message\":\"secret\"}}\n\n".into(),
            "stream error",
        ),
        (
            event(
                serde_json::json!({"refusal":"secret","content":"not emitted"}),
                None,
            ),
            "refused",
        ),
        ("data: {\"choices\":".into(), "truncated SSE"),
        (String::new(), "missing finish_reason"),
    ] {
        let mut decoder = SseDecoder::default();
        let mut stream = CompletionStream::default();
        let mut deltas = Vec::new();
        let mut emit = |delta| {
            deltas.push(delta);
            Ok(())
        };
        decoder
            .feed(
                event(
                    serde_json::json!({"content":"partial","reasoning":"why"}),
                    None,
                )
                .as_bytes(),
                |data| stream.event(data, 10.0, &mut emit),
            )
            .unwrap();
        let error = decoder
            .feed(tail.as_bytes(), |data| stream.event(data, 20.0, &mut emit))
            .and_then(|_| decoder.finish())
            .and_then(|()| stream.validate())
            .unwrap_err();
        assert!(error.contains(expected), "{error}");
        assert_eq!(
            deltas,
            vec![CompletionDelta {
                content: "partial".into(),
                reasoning: "why".into()
            }]
        );
        let reply = stream.finish(30.0, Some(error)).message.unwrap();
        assert_eq!(reply.content, "partial");
        assert_eq!(reply.reasoning, "why");
    }
}

#[test]
fn omits_reasoning_from_request_messages_and_empty_replies() {
    let request = ChatRequest {
        model: "local".into(),
        messages: vec![Message {
            role: Role::Assistant,
            content: "Hi".into(),
            reasoning: "private metadata".into(),
        }],
        reasoning_effort: ReasoningEffort::Off,
    };
    let wire = serde_json::to_value(WireRequest {
        model: &request.model,
        messages: &request.messages,
        reasoning_effort: "none",
        stream: true,
        stream_options: StreamOptions {
            include_usage: true,
        },
    })
    .unwrap();
    assert_eq!(
        wire["messages"],
        serde_json::json!([{"role":"assistant","content":"Hi"}])
    );
    let reply = Message {
        role: Role::Assistant,
        content: "Hi".into(),
        reasoning: String::new(),
    };
    assert!(
        serde_json::to_value(reply)
            .unwrap()
            .get("reasoning")
            .is_none()
    );
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
        let (base, task) = server("200 OK", &completion("Hi")).await;
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
    let split = first
        .as_bytes()
        .iter()
        .position(|byte| *byte == 0xc3)
        .unwrap()
        + 1;
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
    assert_eq!(
        metrics.decode_ms,
        Some(metrics.e2e_ms - metrics.ttft_ms.unwrap())
    );
    assert_eq!(metrics.input_tokens, Some(7));
    assert_eq!(metrics.output_tokens, Some(4));
    assert_eq!(metrics.total_tokens, Some(11));
    assert_eq!(metrics.cached_tokens, Some(0));
    assert_eq!(metrics.reasoning_tokens, Some(2));
    assert_eq!(metrics.prefill_ms, Some(12.5));
    assert_eq!(metrics.server_decode_ms, Some(47.0));
    assert_eq!(
        metrics.output_tps,
        Some(4000.0 / metrics.decode_ms.unwrap())
    );
    assert_eq!(metrics.tpot_ms, Some(metrics.decode_ms.unwrap() / 3.0));
    assert!(metrics.chunk_interval_mean_ms.unwrap() >= 20.0);
    assert_eq!(
        metrics.chunk_interval_max_ms,
        metrics.chunk_interval_mean_ms
    );
    assert_eq!(metrics.chunk_interval_stddev_ms, Some(0.0));
    let serialized = serde_json::to_value(metrics).unwrap();
    for name in ["connection_ms", "tcp_ms"] {
        assert!(
            serialized[name].as_f64().is_some_and(|v| v >= 0.0),
            "{name}"
        );
    }
    for name in [
        "dns_ms",
        "tls_ms",
        "itl_mean_ms",
        "itl_max_ms",
        "itl_stddev_ms",
    ] {
        assert!(serialized[name].is_null(), "{name}");
    }
    let request = task.await.unwrap();
    assert!(!request.to_ascii_lowercase().contains("authorization:"));
}

#[tokio::test]
async fn accepts_clean_finished_stream_and_retains_zero_usage() {
    let body = format!(
        "{}data: {{\"usage\":{{\"prompt_tokens\":0,\"completion_tokens\":0,\"total_tokens\":0}}}}\n\n",
        event(serde_json::json!({"content":"Hi"}), Some("length"))
    );
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
        let (base, task) = stream_server(
            "200 OK",
            vec![
                (Duration::ZERO, first.as_bytes().to_vec()),
                (Duration::from_millis(10), tail.to_vec()),
            ],
            missing_bytes,
        )
        .await;
        let mut deltas = Vec::new();
        let result = complete(&http_client().unwrap(), payload(base, "off"), |delta| {
            deltas.push(delta);
            Ok(())
        })
        .await;
        assert_eq!(
            deltas,
            vec![CompletionDelta {
                content: "partial".into(),
                reasoning: "".into()
            }]
        );
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
    let (base, task) = stream_server(
        "200 OK",
        vec![
            (Duration::ZERO, first.into_bytes()),
            (Duration::from_millis(250), completion("late").into_bytes()),
        ],
        0,
    )
    .await;
    let client =
        http_client_with_timeouts(Duration::from_secs(5), Duration::from_millis(100)).unwrap();
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
        done |= decoder
            .feed(std::slice::from_ref(byte), |data| {
                stream.event(data, 1.0, &mut |_| Ok(()))
            })
            .unwrap();
    }
    assert!(done);
    assert!(stream.validate().is_ok());
    assert_eq!(stream.text, "Hé\n世界");
    let mut decoder = SseDecoder::default();
    let error = decoder
        .feed(&vec![b'x'; MAX_SSE_EVENT_BYTES + 1], |_| Ok(false))
        .unwrap_err();
    assert!(error.contains("oversized"));
    assert!(decoder.line.len() <= MAX_SSE_EVENT_BYTES);
}

#[test]
fn derives_tpot_without_inventing_token_counts_or_itl() {
    for tokens in [None, Some(0), Some(1), Some(2)] {
        for end_ms in [10.0, 30.0] {
            let stream = CompletionStream {
                metrics: CompletionMetrics {
                    ttft_ms: Some(10.0),
                    output_tokens: tokens,
                    ..Default::default()
                },
                ..Default::default()
            };
            let metrics = stream.finish(end_ms, None).metrics;
            assert_eq!(metrics.decode_ms, Some(end_ms - 10.0));
            assert_eq!(
                metrics.tpot_ms,
                tokens
                    .filter(|count| *count > 1)
                    .map(|count| (end_ms - 10.0) / (count - 1) as f64)
            );
            assert_eq!(
                metrics.output_tps,
                tokens
                    .filter(|count| *count > 0 && end_ms > 10.0)
                    .map(|count| count as f64 * 1000.0 / (end_ms - 10.0))
            );
            assert_eq!(metrics.itl_mean_ms, None);
        }
    }
    let mut intervals = ChunkIntervals::default();
    for elapsed in [0.0, 10.0, 30.0, 60.0] {
        intervals.record(elapsed);
    }
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
        let models = fetch_models(
            &http_client().unwrap(),
            Provider {
                base_url,
                api_key: None,
            },
        )
        .await
        .unwrap();
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
    let models = fetch_models(
        &http_client().unwrap(),
        Provider {
            base_url,
            api_key: None,
        },
    )
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
    let models = fetch_models(
        &http_client().unwrap(),
        Provider {
            base_url,
            api_key: None,
        },
    )
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
        let error = fetch_models(
            &client,
            Provider {
                base_url,
                api_key: None,
            },
        )
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
                .error
                .unwrap()
                .contains("nonblank")
        );
    }
}

#[tokio::test]
async fn sends_bearer_auth_only_when_api_key_is_nonblank() {
    let client = http_client().unwrap();

    let (base_url, task) = server("200 OK", r#"{"data":[{"id":"gpt-4o"}]}"#).await;
    fetch_models(
        &client,
        Provider {
            base_url,
            api_key: Some("  sk-models-key  ".into()),
        },
    )
    .await
    .unwrap();
    let models_request = task.await.unwrap();
    assert!(
        models_request
            .to_ascii_lowercase()
            .contains("authorization: bearer sk-models-key\r\n")
    );

    let (base_url, task) = server("200 OK", &completion("ok")).await;
    let mut chat = payload(base_url, "off");
    chat.provider.api_key = Some("sk-chat-key".into());
    assert_eq!(complete(&client, chat, |_| Ok(())).await.error, None);
    let chat_request = task.await.unwrap();
    assert!(
        chat_request
            .to_ascii_lowercase()
            .contains("authorization: bearer sk-chat-key\r\n")
    );

    let (base_url, task) = server("200 OK", r#"{"data":[]}"#).await;
    fetch_models(
        &client,
        Provider {
            base_url,
            api_key: Some("   ".into()),
        },
    )
    .await
    .unwrap();
    let blank_key_request = task.await.unwrap();
    assert!(
        !blank_key_request
            .to_ascii_lowercase()
            .contains("authorization:")
    );
}

#[tokio::test]
async fn records_dns_tcp_and_connection_timings_for_hostnames() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let base = format!("http://localhost:{port}/v1");
    let body = completion("ok");
    let task = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut buf = [0u8; 4096];
        let _ = socket.read(&mut buf).await.unwrap();
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        socket.write_all(response.as_bytes()).await.unwrap();
    });
    let result = complete(&http_client().unwrap(), payload(base, "off"), |_| Ok(())).await;
    assert_eq!(result.error, None);
    assert!(result.metrics.dns_ms.is_some_and(|v| v >= 0.0));
    assert!(result.metrics.tcp_ms.is_some_and(|v| v >= 0.0));
    assert!(result.metrics.connection_ms.is_some_and(|v| v >= 0.0));
    assert_eq!(result.metrics.tls_ms, None);
    task.await.unwrap();
}

#[test]
fn allows_empty_trailing_choice_after_finish_reason_but_rejects_content_or_conflict() {
    let mut stream = CompletionStream::default();
    let mut emit = |_: CompletionDelta| Ok(());
    let finish = br#"{"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}"#;
    let trailing_usage = br#"{"choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}],"usage":{"prompt_tokens":3,"completion_tokens":1,"total_tokens":4}}"#;
    assert!(!stream.event(finish, 10.0, &mut emit).unwrap());
    assert!(!stream.event(trailing_usage, 20.0, &mut emit).unwrap());
    assert!(stream.validate().is_ok());
    assert_eq!(stream.metrics.finish_reason.as_deref(), Some("stop"));
    assert_eq!(stream.metrics.total_tokens, Some(4));

    for bad_after in [
        br#"{"choices":[{"index":0,"delta":{"content":"extra"},"finish_reason":null}]}"#.as_slice(),
        br#"{"choices":[{"index":0,"delta":{"reasoning":"extra"},"finish_reason":null}]}"#
            .as_slice(),
        br#"{"choices":[{"index":0,"delta":{},"finish_reason":"length"}]}"#.as_slice(),
    ] {
        let mut s = CompletionStream::default();
        assert!(!s.event(finish, 10.0, &mut emit).unwrap());
        let err = s.event(bad_after, 20.0, &mut emit).unwrap_err();
        assert!(err.contains("after its finish reason"), "{err}");
    }
}

#[tokio::test]
async fn allows_long_streams_within_chunk_timeout_and_enforces_connect_timeout() {
    let chunk = event(serde_json::json!({"content":"a"}), None).into_bytes();
    let (base, task) = stream_server(
        "200 OK",
        vec![
            (Duration::from_millis(60), chunk.clone()),
            (Duration::from_millis(60), chunk),
            (Duration::from_millis(60), completion("done").into_bytes()),
        ],
        0,
    )
    .await;
    let client =
        http_client_with_timeouts(Duration::from_secs(5), Duration::from_millis(120)).unwrap();
    let result = complete(&client, payload(base, "off"), |_| Ok(())).await;
    assert_eq!(result.error, None);
    assert!(result.metrics.e2e_ms >= 150.0);
    task.await.unwrap();

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("https://{}/v1", listener.local_addr().unwrap());
    let server_task = tokio::spawn(async move {
        let (_socket, _) = listener.accept().await.unwrap();
        tokio::time::sleep(Duration::from_millis(250)).await;
    });
    let slow_connect =
        http_client_with_timeouts(Duration::from_millis(80), Duration::from_secs(5)).unwrap();
    let result = complete(&slow_connect, payload(base, "off"), |_| Ok(())).await;
    assert!(result.error.unwrap().contains("timed out"));
    assert!(result.metrics.timed_out);
    assert_eq!(result.metrics.http_status, None);
    server_task.await.unwrap();
}

#[tokio::test]
async fn cancels_streaming_completion_and_preserves_partial_text() {
    let first = event(serde_json::json!({"content":"partial"}), None);
    let (base, task) = stream_server(
        "200 OK",
        vec![
            (Duration::ZERO, first.into_bytes()),
            (Duration::from_secs(5), completion("late").into_bytes()),
        ],
        0,
    )
    .await;
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut tx = Some(tx);
    let result = complete_cancellable(
        &http_client().unwrap(),
        payload(base, "off"),
        async move {
            let _ = rx.await;
        },
        |_| {
            if let Some(tx) = tx.take() {
                let _ = tx.send(());
            }
            Ok(())
        },
    )
    .await;
    assert_eq!(result.error.as_deref(), Some("Generation cancelled."));
    assert!(!result.metrics.timed_out);
    assert_eq!(result.message.unwrap().content, "partial");
    task.await.unwrap();
}
