use std::time::Duration;

use chandelier_core::{
    domain::{Provider, Result},
    infrastructure::http::{
        ApiEvent, ApiEventKind, OpenAiAdapter, validate_base_url, validate_model_identifier,
        validate_provider,
    },
};
use serde_json::{Value, json};
use sqlx::types::Json;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    sync::{mpsc, oneshot},
    task::JoinHandle,
    time::{sleep, timeout},
};
use tokio_util::sync::CancellationToken;

struct Mock {
    root: String,
    request: oneshot::Receiver<Vec<u8>>,
    task: JoinHandle<()>,
}

impl Drop for Mock {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn mock(parts: Vec<(Duration, Vec<u8>)>) -> Mock {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let root = format!("http://{}/v1", listener.local_addr().unwrap());
    let (sender, request) = oneshot::channel();
    let task = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = Vec::new();
        loop {
            let mut buffer = [0u8; 4096];
            let count = socket.read(&mut buffer).await.unwrap();
            if count == 0 {
                return;
            }
            request.extend_from_slice(&buffer[.. count]);
            assert!(request.len() < 1024 * 1024);
            if let Some(end) = request.windows(4).position(|window| window == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&request[.. end]).to_ascii_lowercase();
                let length = headers
                    .lines()
                    .find_map(|line| line.strip_prefix("content-length:"))
                    .map(|length| length.trim().parse::<usize>().unwrap())
                    .unwrap_or(0);
                if request.len() >= end + 4 + length {
                    break;
                }
            }
        }
        let _ = sender.send(request);
        for (delay, bytes) in parts {
            sleep(delay).await;
            if socket.write_all(&bytes).await.is_err() {
                return;
            }
        }
    });
    Mock {
        root,
        request,
        task,
    }
}

fn response(status: u16, content_type: &str, body: &[u8]) -> Vec<u8> {
    let mut bytes = format!("HTTP/1.1 {status} Mock\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).into_bytes();
    bytes.extend_from_slice(body);
    bytes
}

async fn ready(status: u16, content_type: &str, body: &[u8]) -> Mock {
    mock(vec![(Duration::ZERO, response(status, content_type, body))]).await
}

fn provider(root: &str) -> Provider {
    Provider {
        id: "local".into(),
        name: "Local HTTP test".into(),
        base_url: root.into(),
        authentication_mode: "none".into(),
        credential_reference: None,
        timeout_seconds: 2,
        supports_usage: true,
        default_parameters: Json(json!({})),
        created_at: 0,
    }
}

fn body() -> Value {
    json!({"model": "test-model", "messages": [{"role": "user", "content": "Hello"}], "stream": true})
}

async fn collect(
    provider: &Provider,
    key: Option<&str>,
    cancel: CancellationToken,
) -> (Result<()>, Vec<ApiEvent>) {
    let provider = provider.clone();
    let key = key.map(str::to_owned);
    let (tx, mut rx) = mpsc::channel(4);
    let task = tokio::spawn(async move {
        OpenAiAdapter::stream(&provider, key.as_deref(), &body(), cancel, tx).await
    });
    timeout(Duration::from_secs(5), async {
        let mut events = Vec::new();
        while let Some(event) = rx.recv().await {
            events.push(event);
        }
        (task.await.unwrap(), events)
    })
    .await
    .expect("local stream did not finish")
}

const CONTENT: &str = "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\n";
const FINISH: &str = "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n";
const DONE: &str = "data: [DONE]\n\n";

#[tokio::test]
async fn models_and_chat_use_api_root_bearer_and_real_json() {
    let mut server = ready(
        200,
        "application/json",
        br#"{"data":[{"id":"test-model"},{"id":"org/model:latest"}]}"#,
    )
    .await;
    let mut config = provider(&format!("{}/", server.root));
    config.authentication_mode = "bearer".into();
    assert_eq!(
        OpenAiAdapter::models(&config, Some("test-secret"))
            .await
            .unwrap(),
        ["test-model", "org/model:latest"]
    );
    let request = String::from_utf8((&mut server.request).await.unwrap()).unwrap();
    assert!(request.starts_with("GET /v1/models HTTP/1.1\r\n"));
    assert!(
        request
            .to_ascii_lowercase()
            .contains("authorization: bearer test-secret\r\n")
    );

    let usage = json!({"prompt_tokens": 2, "completion_tokens": 1, "total_tokens": 3});
    let source = format!(
        "data: {{\"choices\":[{{\"delta\":{{\"role\":\"assistant\"}}}}]}}\n\n{CONTENT}{FINISH}data: {{\"choices\":[],\"usage\":{usage}}}\n\n{DONE}"
    );
    let mut server = ready(200, "text/event-stream; charset=utf-8", source.as_bytes()).await;
    let (result, events) = collect(
        &provider(&server.root),
        Some("unused-secret"),
        CancellationToken::new(),
    )
    .await;
    result.unwrap();
    assert_eq!(
        events
            .iter()
            .map(|event| event.kind.clone())
            .collect::<Vec<_>>(),
        vec![
            ApiEventKind::Headers,
            ApiEventKind::Event,
            ApiEventKind::Event,
            ApiEventKind::Content("Hello".into()),
            ApiEventKind::Event,
            ApiEventKind::Finish("stop".into()),
            ApiEventKind::Event,
            ApiEventKind::Usage(usage),
            ApiEventKind::Event,
        ]
    );
    assert!(events.windows(2).all(|pair| pair[0].at <= pair[1].at));
    assert_eq!(events[2].at, events[3].at);
    let request = String::from_utf8((&mut server.request).await.unwrap()).unwrap();
    assert!(request.starts_with("POST /v1/chat/completions HTTP/1.1\r\n"));
    assert!(!request.to_ascii_lowercase().contains("authorization:"));
    let json: Value = serde_json::from_str(request.split_once("\r\n\r\n").unwrap().1).unwrap();
    assert_eq!(json, body());
}

#[tokio::test]
async fn chunked_utf8_multiline_crlf_cr_comments_and_no_usage() {
    let source = ": comment\r\ndata: {\"choices\": [\r\ndata: {\"delta\": {\"content\": \"日本語\"}}]}\r\n\r\ndata: {\"choices\":[{\"delta\":{\"content\":\"!\"}}]}\r\rdata: [DONE]\r\r";
    let mut parts = vec![(Duration::ZERO, b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n".to_vec())];
    for byte in source.bytes() {
        parts.push((Duration::ZERO, vec![b'1', b'\r', b'\n', byte, b'\r', b'\n']));
    }
    parts.push((Duration::ZERO, b"0\r\n\r\n".to_vec()));
    let server = mock(parts).await;
    let (result, events) = collect(&provider(&server.root), None, CancellationToken::new()).await;
    result.unwrap();
    let text: String = events
        .iter()
        .filter_map(|event| match &event.kind {
            ApiEventKind::Content(text) => Some(text.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(text, "日本語!");
    assert_eq!(
        events
            .iter()
            .filter(|event| event.kind == ApiEventKind::Event)
            .count(),
        3
    );
    assert!(
        !events
            .iter()
            .any(|event| matches!(event.kind, ApiEventKind::Usage(_)))
    );
}

#[tokio::test]
async fn status_errors_are_typed_and_redacted() {
    for (status, code) in [
        (401, "authentication"),
        (403, "authentication"),
        (429, "rate_limit"),
        (404, "model_not_found"),
        (408, "timeout"),
        (504, "timeout"),
        (500, "api"),
    ] {
        let server = ready(
            status,
            "application/json",
            br#"{"error":{"message":"SECRET test-secret"}}"#,
        )
        .await;
        let (result, _) = collect(&provider(&server.root), None, CancellationToken::new()).await;
        let error = result.unwrap_err();
        assert_eq!(error.code, code);
        assert!(!error.message.contains("SECRET"));
        assert!(!error.message.contains("test-secret"));
        assert!(!error.message.contains(&server.root));
    }
    let mut config = provider("http://127.0.0.1:1/v1");
    config.authentication_mode = "bearer".into();
    for key in [None, Some(""), Some("\r\nsecret")] {
        assert_eq!(
            collect(&config, key, CancellationToken::new())
                .await
                .0
                .unwrap_err()
                .code,
            "authentication"
        );
        assert_eq!(
            OpenAiAdapter::models(&config, key).await.unwrap_err().code,
            "authentication"
        );
    }
}

#[tokio::test]
async fn redirects_never_reach_the_other_listener() {
    let target = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let location = format!("http://{}/stolen", target.local_addr().unwrap());
    for status in [301, 302, 307, 308] {
        let reply = format!(
            "HTTP/1.1 {status} Redirect\r\nLocation: {location}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        );
        let server = mock(vec![(Duration::ZERO, reply.into_bytes())]).await;
        let mut config = provider(&server.root);
        config.authentication_mode = "bearer".into();
        assert_eq!(
            collect(&config, Some("test-secret"), CancellationToken::new())
                .await
                .0
                .unwrap_err()
                .code,
            "api"
        );
        assert!(
            timeout(Duration::from_millis(30), target.accept())
                .await
                .is_err()
        );
    }
}

#[tokio::test]
async fn timeout_covers_headers_and_the_whole_body_not_idle_time() {
    let server = mock(vec![(
        Duration::from_secs(2),
        response(200, "text/event-stream", DONE.as_bytes()),
    )])
    .await;
    let mut config = provider(&server.root);
    config.timeout_seconds = 1;
    assert_eq!(
        collect(&config, None, CancellationToken::new())
            .await
            .0
            .unwrap_err()
            .code,
        "timeout"
    );

    let headers =
        b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n";
    let server = mock(vec![
        (Duration::from_millis(600), headers.to_vec()),
        (Duration::from_millis(600), CONTENT.as_bytes().to_vec()),
    ])
    .await;
    let mut config = provider(&server.root);
    config.timeout_seconds = 1;
    let (result, events) = collect(&config, None, CancellationToken::new()).await;
    assert_eq!(result.unwrap_err().code, "timeout");
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].kind, ApiEventKind::Headers);

    let server = mock(vec![(
        Duration::from_secs(2),
        response(200, "application/json", br#"{"data":[]}"#),
    )])
    .await;
    config.base_url = server.root.clone();
    assert_eq!(
        OpenAiAdapter::models(&config, None).await.unwrap_err().code,
        "timeout"
    );
}

#[tokio::test]
async fn eof_and_truncated_http_preserve_content_but_are_not_completion() {
    for truncated in [false, true] {
        let source = format!("{CONTENT}{FINISH}");
        let bytes = if truncated {
            format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{source}", source.len() + 100).into_bytes()
        } else {
            response(200, "text/event-stream", source.as_bytes())
        };
        let server = mock(vec![(Duration::ZERO, bytes)]).await;
        let (result, events) =
            collect(&provider(&server.root), None, CancellationToken::new()).await;
        assert_eq!(result.unwrap_err().code, "disconnected");
        assert!(
            events
                .iter()
                .any(|event| event.kind == ApiEventKind::Content("Hello".into()))
        );
        assert!(
            events
                .iter()
                .any(|event| event.kind == ApiEventKind::Finish("stop".into()))
        );
    }
}

#[tokio::test]
async fn cancellation_interrupts_send_read_and_backpressure() {
    // No headers: the cancellation must drop the pending reqwest send.
    let mut server = mock(vec![(Duration::from_secs(10), vec![])]).await;
    let config = provider(&server.root);
    let cancel = CancellationToken::new();
    let token = cancel.clone();
    let task = tokio::spawn(async move { collect(&config, None, token).await });
    (&mut server.request).await.unwrap();
    cancel.cancel();
    assert_eq!(
        timeout(Duration::from_millis(500), task)
            .await
            .unwrap()
            .unwrap()
            .0
            .unwrap_err()
            .code,
        "cancelled"
    );

    // Received content remains available when cancellation interrupts a body read.
    let headers =
        b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n";
    let server = mock(vec![
        (Duration::ZERO, headers.to_vec()),
        (Duration::ZERO, CONTENT.as_bytes().to_vec()),
        (Duration::from_secs(10), vec![]),
    ])
    .await;
    let config = provider(&server.root);
    let cancel = CancellationToken::new();
    let token = cancel.clone();
    let (tx, mut rx) = mpsc::channel(4);
    let task =
        tokio::spawn(async move { OpenAiAdapter::stream(&config, None, &body(), token, tx).await });
    while !matches!(
        timeout(Duration::from_secs(2), rx.recv())
            .await
            .unwrap()
            .unwrap()
            .kind,
        ApiEventKind::Content(_)
    ) {}
    cancel.cancel();
    assert_eq!(
        timeout(Duration::from_millis(500), task)
            .await
            .unwrap()
            .unwrap()
            .unwrap_err()
            .code,
        "cancelled"
    );

    // A full bounded channel cannot delay cancellation.
    let server = ready(
        200,
        "text/event-stream",
        format!("{CONTENT}{DONE}").as_bytes(),
    )
    .await;
    let config = provider(&server.root);
    let cancel = CancellationToken::new();
    let token = cancel.clone();
    let (tx, mut rx) = mpsc::channel(1);
    let task =
        tokio::spawn(async move { OpenAiAdapter::stream(&config, None, &body(), token, tx).await });
    assert_eq!(rx.recv().await.unwrap().kind, ApiEventKind::Headers);
    sleep(Duration::from_millis(30)).await;
    assert_eq!(rx.len(), 1);
    cancel.cancel();
    assert_eq!(
        timeout(Duration::from_millis(500), task)
            .await
            .unwrap()
            .unwrap()
            .unwrap_err()
            .code,
        "cancelled"
    );

    let cancelled = CancellationToken::new();
    cancelled.cancel();
    assert_eq!(
        collect(&provider("http://127.0.0.1:1/v1"), None, cancelled)
            .await
            .0
            .unwrap_err()
            .code,
        "cancelled"
    );
}

#[tokio::test]
async fn channel_deadline_and_observation_timestamps_survive_backpressure() {
    let server = ready(
        200,
        "text/event-stream",
        format!("{CONTENT}{DONE}").as_bytes(),
    )
    .await;
    let mut config = provider(&server.root);
    config.timeout_seconds = 1;
    let (tx, _rx) = mpsc::channel(1);
    let result = timeout(
        Duration::from_secs(2),
        OpenAiAdapter::stream(&config, None, &body(), CancellationToken::new(), tx),
    )
    .await
    .unwrap();
    assert_eq!(result.unwrap_err().code, "timeout");

    let server = ready(
        200,
        "text/event-stream",
        format!("{CONTENT}{DONE}").as_bytes(),
    )
    .await;
    let config = provider(&server.root);
    let (tx, mut rx) = mpsc::channel(1);
    let task = tokio::spawn(async move {
        OpenAiAdapter::stream(&config, None, &body(), CancellationToken::new(), tx).await
    });
    assert_eq!(rx.recv().await.unwrap().kind, ApiEventKind::Headers);
    let event = rx.recv().await.unwrap();
    sleep(Duration::from_millis(30)).await;
    let content = rx.recv().await.unwrap();
    assert_eq!(event.kind, ApiEventKind::Event);
    assert_eq!(content.kind, ApiEventKind::Content("Hello".into()));
    assert_eq!(event.at, content.at);
    assert!(event.at.elapsed() >= Duration::from_millis(20));
    while rx.recv().await.is_some() {}
    task.await.unwrap().unwrap();
}

#[tokio::test]
async fn invalid_sse_utf8_json_shapes_and_content_types_are_format_errors() {
    for bytes in [
        b"data: {invalid}\n\n".as_slice(),
        b"data: {\"choices\":123}\n\n",
        b"data: {\"choices\":[{\"delta\":{\"content\":9}}]}\n\n",
        b"data: {\"choices\":[{\"delta\":{\"content\":\"\xff\"}}]}\n\n",
    ] {
        let server = ready(200, "text/event-stream", bytes).await;
        assert_eq!(
            collect(&provider(&server.root), None, CancellationToken::new())
                .await
                .0
                .unwrap_err()
                .code,
            "format"
        );
    }
    let server = ready(200, "application/json", br#"{"choices":[]}"#).await;
    assert_eq!(
        collect(&provider(&server.root), None, CancellationToken::new())
            .await
            .0
            .unwrap_err()
            .code,
        "format"
    );
    for bytes in [
        b"[]".as_slice(),
        b"{}",
        b"{\"data\":{}}",
        b"{\"data\":[{}]}",
        b"{\"data\":[{\"id\":\"\"}]}",
        b"{\"data\":[{\"id\":null}]}",
        b"{\"data\":[{\"id\":\"bad model\"}]}",
    ] {
        let server = ready(200, "application/json", bytes).await;
        assert_eq!(
            OpenAiAdapter::models(&provider(&server.root), None)
                .await
                .unwrap_err()
                .code,
            "format"
        );
    }
    let server = ready(200, "application/json", br#"{"data":[]}"#).await;
    assert!(
        OpenAiAdapter::models(&provider(&server.root), None)
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn network_failure_is_sanitized_and_dropped_consumer_cancels() {
    let disconnected = mock(vec![]).await;
    let root = format!("{}/private-path", disconnected.root);
    let error = collect(&provider(&root), None, CancellationToken::new())
        .await
        .0
        .unwrap_err();
    assert_eq!(error.code, "network");
    assert!(!error.message.contains("private-path"));
    let server = ready(200, "text/event-stream", DONE.as_bytes()).await;
    let (tx, rx) = mpsc::channel(1);
    drop(rx);
    assert_eq!(
        OpenAiAdapter::stream(
            &provider(&server.root),
            None,
            &body(),
            CancellationToken::new(),
            tx
        )
        .await
        .unwrap_err()
        .code,
        "cancelled"
    );
}

#[tokio::test]
async fn done_completes_without_waiting_for_connection_close() {
    let headers =
        b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n";
    let server = mock(vec![
        (Duration::ZERO, headers.to_vec()),
        (Duration::ZERO, format!("{CONTENT}{DONE}").into_bytes()),
        (Duration::from_secs(10), vec![]),
    ])
    .await;
    let (result, _) = timeout(
        Duration::from_millis(500),
        collect(&provider(&server.root), None, CancellationToken::new()),
    )
    .await
    .unwrap();
    result.unwrap();
}

#[tokio::test]
async fn invalid_request_model_is_rejected_before_network_io() {
    for body in [
        json!({}),
        json!({"model": ""}),
        json!({"model": "bad model"}),
        json!({"model": 1}),
    ] {
        let (tx, _rx) = mpsc::channel(1);
        let error = OpenAiAdapter::stream(
            &provider("http://127.0.0.1:1/v1"),
            None,
            &body,
            CancellationToken::new(),
            tx,
        )
        .await
        .unwrap_err();
        assert_eq!(error.code, "validation");
    }
}

#[test]
fn validation_rejects_unsafe_urls_providers_and_identifiers() {
    assert_eq!(
        validate_base_url("http://localhost:1234/v1///")
            .unwrap()
            .as_str(),
        "http://localhost:1234/v1/"
    );
    assert_eq!(
        validate_base_url("https://example.test").unwrap().as_str(),
        "https://example.test/"
    );
    for url in [
        "",
        "not a URL",
        "file:///tmp/key",
        "ftp://example.test/v1",
        "http:///",
        "https://user:secret@example.test/v1",
        "https://example.test/v1?key=secret",
        "https://example.test/v1#secret",
        " https://example.test/v1",
        "https://example.test/\n",
    ] {
        let error = validate_base_url(url).unwrap_err();
        assert_eq!(error.code, "validation");
        assert!(!error.message.contains("secret"));
    }
    for id in ["", " ", " model", "model ", "bad\nmodel", "bad model"] {
        assert!(validate_model_identifier(id).is_err());
    }
    assert!(validate_model_identifier("org/model:latest").is_ok());
    let mut config = provider("http://localhost:1234/v1");
    config.timeout_seconds = 0;
    assert!(validate_provider(&config).is_err());
    config.timeout_seconds = 2;
    config.authentication_mode = "unknown".into();
    assert!(validate_provider(&config).is_err());
}
