use std::sync::{Arc, Mutex};

use chandelier_core::{domain::*, infrastructure::database::Db, services::ChatService};
use serde_json::{Value, json};
use sqlx::types::Json;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    sync::{Notify, oneshot},
};

async fn setup(url: String) -> (Db, Session, std::path::PathBuf) {
    let directory = std::env::temp_dir().join(format!("chandelier-service-{}", id()));
    let db = Db::open(&directory.join("test.sqlite3")).await.unwrap();
    let provider = Provider {
        id: id(),
        name: "mock".into(),
        base_url: url,
        authentication_mode: "none".into(),
        credential_reference: None,
        timeout_seconds: 10,
        supports_usage: true,
        default_parameters: Json(json!({"temperature":0.8,"frequency_penalty":0.2})),
        created_at: now(),
    };
    let model = Model {
        id: id(),
        provider_id: provider.id.clone(),
        model_identifier: "test-model".into(),
        display_name: "Test".into(),
        context_window: Some(1000),
        capabilities: Json(
            json!({"unsupported_parameters":["frequency_penalty"],"max_tokens_parameter":"max_tokens"}),
        ),
        default_parameters: Json(json!({"temperature":0.6,"max_completion_tokens":30})),
    };
    db.save_provider(&provider).await.unwrap();
    db.save_model(&model).await.unwrap();
    db.set_settings(&json!({"generation":{"temperature":1,"system_prompt":"System instruction"}}))
        .await
        .unwrap();
    let session = db.create_session("service integration").await.unwrap();
    let session = db
        .update_session(
            &session.id,
            &session.title,
            Some(&model.id),
            &json!({"temperature":0.4}),
        )
        .await
        .unwrap();
    (db, session, directory)
}

async fn request(socket: &mut tokio::net::TcpStream) -> Value {
    let mut bytes = Vec::new();
    let mut buffer = [0; 4096];
    loop {
        let count = socket.read(&mut buffer).await.unwrap();
        assert!(count > 0);
        bytes.extend_from_slice(&buffer[.. count]);
        if let Some(end) = bytes.windows(4).position(|v| v == b"\r\n\r\n") {
            let headers = String::from_utf8_lossy(&bytes[.. end]);
            let size: usize = headers
                .lines()
                .find_map(|line| {
                    line.to_ascii_lowercase()
                        .strip_prefix("content-length:")
                        .map(|v| v.trim().parse().unwrap())
                })
                .unwrap();
            if bytes.len() >= end + 4 + size {
                return serde_json::from_slice(&bytes[end + 4 .. end + 4 + size]).unwrap();
            }
        }
    }
}

#[tokio::test]
async fn actual_stream_preserves_final_body_edit_history_and_terminal_events() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/v1", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        let mut requests = Vec::new();
        for _ in 0 .. 3 {
            let (mut socket, _) = listener.accept().await.unwrap();
            requests.push(request(&mut socket).await);
            let body = "data: {\"choices\":[{\"delta\":{\"role\":\"assistant\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"回答\\ntext\"},\"finish_reason\":\"stop\"}]}\n\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":20,\"completion_tokens\":4,\"total_tokens\":24}}\n\ndata: [DONE]\n\n";
            socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).as_bytes()).await.unwrap();
        }
        requests
    });
    let (db, session, directory) = setup(url).await;
    let service = ChatService::new(db.clone());
    let events = Arc::new(Mutex::new(Vec::<StreamEvent>::new()));
    for (action, content, message_id) in
        [("send", Some("original"), None), ("regenerate", None, None)]
    {
        let events = events.clone();
        service
            .generate(
                GenerateInput {
                    session_id: session.id.clone(),
                    action: action.into(),
                    content: content.map(str::to_owned),
                    message_id,
                    parameters: json!({"temperature":0.2}),
                },
                |_| Ok(None),
                move |event| {
                    events.lock().unwrap().push(event);
                    Ok(())
                },
            )
            .await
            .unwrap();
    }
    let detail = db.session(&session.id).await.unwrap();
    service
        .generate(
            GenerateInput {
                session_id: session.id.clone(),
                action: "edit".into(),
                content: Some("revised".into()),
                message_id: Some(detail.messages[0].id.clone()),
                parameters: json!({"temperature":0.2}),
            },
            |_| Ok(None),
            |_| Ok(()),
        )
        .await
        .unwrap();
    let requests = server.await.unwrap();
    assert_eq!(requests[0]["temperature"], 0.2);
    assert_eq!(requests[0]["max_tokens"], 30);
    assert!(requests[0].get("max_completion_tokens").is_none());
    assert!(requests[0].get("frequency_penalty").is_none());
    assert_eq!(
        requests[0]["messages"],
        json!([{"role":"system","content":"System instruction"},{"role":"user","content":"original"}])
    );
    assert_eq!(requests[0], requests[1]);
    assert_eq!(requests[2]["messages"][1]["content"], "revised");
    let detail = db.session(&session.id).await.unwrap();
    assert_eq!(
        detail
            .messages
            .iter()
            .map(|m| m.content.as_str())
            .collect::<Vec<_>>(),
        vec!["revised", "回答\ntext"]
    );
    assert_eq!(detail.generations.len(), 3);
    let original_id = events.lock().unwrap()[0].generation_id.clone();
    let original = detail
        .generations
        .iter()
        .find(|g| g.id == original_id)
        .unwrap();
    assert_eq!(
        original.request_snapshot["body"]["messages"][1]["content"],
        "original"
    );
    let metrics = detail
        .metrics
        .iter()
        .find(|metrics| metrics.generation_id == original_id)
        .unwrap();
    assert_eq!(
        (
            metrics.input_tokens,
            metrics.output_tokens,
            metrics.total_tokens
        ),
        (Some(20), Some(4), Some(24))
    );
    assert_eq!(metrics.context_window, Some(1000));
    assert_eq!(metrics.context_usage_percent, Some(2.0));
    assert_eq!(metrics.remaining_context, Some(980));
    assert_eq!(metrics.usage_source, "api");
    assert_eq!(metrics.output_tps, None);
    assert_eq!(metrics.generation_duration_ms, Some(0.0));
    assert_eq!(metrics.generation_throughput, None);
    assert!(metrics.request_latency_ms.unwrap() >= 0.0);
    assert!(metrics.request_latency_ms <= metrics.first_event_ms);
    assert!(metrics.first_event_ms <= metrics.ttft_ms);
    assert!(metrics.ttft_ms <= metrics.total_duration_ms);
    assert_eq!(original.status, "completed");
    assert_eq!(original.finish_reason.as_deref(), Some("stop"));
    let saved_metrics = serde_json::to_value(metrics).unwrap();
    let archived = db.generation_message(&original_id).await.unwrap();
    assert_eq!(archived.content, "回答\ntext");
    assert!(!archived.active);
    let events = std::mem::take(&mut *events.lock().unwrap());
    for attempt in events.split_inclusive(|e| e.kind == "completed") {
        assert_eq!(attempt.first().unwrap().kind, "started");
        assert_eq!(attempt.last().unwrap().kind, "completed");
        assert_eq!(
            attempt
                .iter()
                .filter_map(|e| e.delta.as_deref())
                .collect::<String>(),
            "回答\ntext"
        );
        assert!(
            attempt
                .windows(2)
                .all(|pair| pair[0].sequence < pair[1].sequence
                    && pair[0].generation_id == pair[1].generation_id)
        );
        let terminal_metrics = attempt.last().unwrap().metrics.as_ref().unwrap();
        assert_eq!(terminal_metrics.total_tokens, Some(24));
        let usage_metrics = attempt
            .iter()
            .find(|event| event.kind == "usage")
            .unwrap()
            .metrics
            .as_ref()
            .unwrap();
        assert_eq!(usage_metrics.input_tokens, Some(20));
        assert_eq!(usage_metrics.context_usage_percent, Some(2.0));
        assert_eq!(usage_metrics.total_duration_ms, None);
    }
    drop(events);
    drop(service);
    db.pool.close().await;
    drop(db);
    let reopened = Db::open(&directory.join("test.sqlite3")).await.unwrap();
    let detail = reopened.session(&session.id).await.unwrap();
    assert_eq!(
        serde_json::to_value(
            detail
                .metrics
                .iter()
                .find(|metrics| metrics.generation_id == original_id)
                .unwrap()
        )
        .unwrap(),
        saved_metrics
    );
    reopened.pool.close().await;
    let _ = std::fs::remove_dir_all(directory);
}

#[tokio::test]
async fn same_session_is_single_flight_and_cancel_keeps_received_content() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/v1", listener.local_addr().unwrap());
    let (closed_tx, closed_rx) = oneshot::channel();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let _ = request(&mut socket).await;
        socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\ndata: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n").await.unwrap();
        let mut buffer = [0; 1];
        let count = socket.read(&mut buffer).await.unwrap();
        let _ = closed_tx.send(count);
    });
    let (db, session, directory) = setup(url).await;
    let service = ChatService::new(db.clone());
    let received = Arc::new(Notify::new());
    let notified = received.notified();
    let input = GenerateInput {
        session_id: session.id.clone(),
        action: "send".into(),
        content: Some("hello".into()),
        message_id: None,
        parameters: json!({}),
    };
    let task = {
        let service = service.clone();
        let input = input.clone();
        let received = received.clone();
        tokio::spawn(async move {
            service
                .generate(
                    input,
                    |_| Ok(None),
                    move |event| {
                        if event.kind == "delta" {
                            received.notify_one();
                        }
                        Ok(())
                    },
                )
                .await
        })
    };
    tokio::time::timeout(std::time::Duration::from_secs(5), notified)
        .await
        .unwrap();
    let duplicate = service
        .generate(input, |_| Ok(None), |_| Ok(()))
        .await
        .unwrap_err();
    assert_eq!(duplicate.code, "busy");
    service.cancel(&session.id).await.unwrap();
    task.await.unwrap().unwrap();
    assert_eq!(
        tokio::time::timeout(std::time::Duration::from_secs(5), closed_rx)
            .await
            .unwrap()
            .unwrap(),
        0
    );
    server.await.unwrap();
    let detail = db.session(&session.id).await.unwrap();
    assert_eq!(detail.messages[1].content, "partial");
    assert_eq!(detail.generations[0].status, "cancelled");
    assert_eq!(detail.generations.len(), 1);
    let metrics = &detail.metrics[0];
    assert!(metrics.request_latency_ms.is_some());
    assert!(metrics.first_event_ms.is_some());
    assert!(metrics.ttft_ms.is_some());
    assert_eq!(metrics.generation_duration_ms, Some(0.0));
    assert!(metrics.total_duration_ms.unwrap() >= metrics.ttft_ms.unwrap());
    assert_eq!(metrics.context_window, Some(1000));
    assert_eq!(metrics.input_tokens, None);
    assert_eq!(metrics.output_tokens, None);
    assert_eq!(metrics.total_tokens, None);
    assert_eq!(metrics.generation_throughput, None);
    assert_eq!(metrics.output_tps, None);
    assert_eq!(metrics.context_usage_percent, None);
    assert_eq!(metrics.remaining_context, None);
    assert_eq!(metrics.usage_source, "unavailable");
    let saved_metrics = serde_json::to_value(metrics).unwrap();
    drop(service);
    db.pool.close().await;
    drop(db);
    let reopened = Db::open(&directory.join("test.sqlite3")).await.unwrap();
    let detail = reopened.session(&session.id).await.unwrap();
    assert_eq!(detail.generations[0].status, "cancelled");
    assert_eq!(
        serde_json::to_value(&detail.metrics[0]).unwrap(),
        saved_metrics
    );
    reopened.pool.close().await;
    let _ = std::fs::remove_dir_all(directory);
}

#[tokio::test]
async fn streamed_usage_rates_and_missing_usage_survive_reopen() {
    for usage in [
        None,
        Some(json!({"prompt_tokens":null,"completion_tokens":null,"total_tokens":null})),
        Some(json!({"prompt_tokens":125,"completion_tokens":20,
            "prompt_tokens_details":{"cached_tokens":10},
            "completion_tokens_details":{"reasoning_tokens":7}})),
    ] {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/v1", listener.local_addr().unwrap());
        let reported = usage
            .as_ref()
            .is_some_and(|usage| usage["prompt_tokens"].is_number());
        let received = Arc::new(Notify::new());
        let first_content = received.clone();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let _ = request(&mut socket).await;
            socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\ndata: {\"choices\":[{\"delta\":{\"content\":\"first\"}}]}\n\n").await.unwrap();
            first_content.notified().await;
            tokio::time::sleep(std::time::Duration::from_millis(30)).await;
            socket.write_all(b"data: {\"choices\":[{\"delta\":{\"content\":\"last\"},\"finish_reason\":\"stop\"}]}\n\n").await.unwrap();
            if let Some(usage) = usage {
                socket
                    .write_all(
                        format!("data: {}\n\n", json!({"choices":[],"usage":usage})).as_bytes(),
                    )
                    .await
                    .unwrap();
            }
            socket.write_all(b"data: [DONE]\n\n").await.unwrap();
        });
        let (db, session, directory) = setup(url).await;
        let service = ChatService::new(db.clone());
        let events = Arc::new(Mutex::new(Vec::<StreamEvent>::new()));
        let output = events.clone();
        service
            .generate(
                GenerateInput {
                    session_id: session.id.clone(),
                    action: "send".into(),
                    content: Some("hello".into()),
                    message_id: None,
                    parameters: json!({}),
                },
                |_| Ok(None),
                move |event| {
                    if event.delta.as_deref() == Some("first") {
                        received.notify_one();
                    }
                    output.lock().unwrap().push(event);
                    Ok(())
                },
            )
            .await
            .unwrap();
        server.await.unwrap();
        let detail = db.session(&session.id).await.unwrap();
        assert_eq!(detail.messages[1].content, "firstlast");
        assert_eq!(detail.generations[0].finish_reason.as_deref(), Some("stop"));
        let metrics = &detail.metrics[0];
        assert!(metrics.generation_duration_ms.unwrap() > 0.0);
        assert!(
            metrics.total_duration_ms.unwrap()
                >= metrics.ttft_ms.unwrap() + metrics.generation_duration_ms.unwrap() - 0.000001
        );
        assert_eq!(metrics.output_tps, None);
        if reported {
            assert_eq!(
                (
                    metrics.input_tokens,
                    metrics.output_tokens,
                    metrics.total_tokens
                ),
                (Some(125), Some(20), Some(145))
            );
            assert_eq!(
                (metrics.cached_tokens, metrics.reasoning_tokens),
                (Some(10), Some(7))
            );
            assert_eq!(metrics.context_usage_percent, Some(12.5));
            assert_eq!(metrics.remaining_context, Some(875));
            assert_eq!(metrics.usage_source, "api");
            assert!(
                (metrics.generation_throughput.unwrap()
                    - 20.0 / (metrics.generation_duration_ms.unwrap() / 1000.0))
                    .abs()
                    < 0.000001
            );
        } else {
            assert_eq!(metrics.input_tokens, None);
            assert_eq!(metrics.output_tokens, None);
            assert_eq!(metrics.total_tokens, None);
            assert_eq!(metrics.generation_throughput, None);
            assert_eq!(metrics.context_usage_percent, None);
            assert_eq!(metrics.remaining_context, None);
            assert_eq!(metrics.usage_source, "unavailable");
        }
        let saved_metrics = serde_json::to_value(metrics).unwrap();
        let terminal = serde_json::to_value(
            events
                .lock()
                .unwrap()
                .last()
                .unwrap()
                .metrics
                .as_ref()
                .unwrap(),
        )
        .unwrap();
        assert_eq!(terminal, saved_metrics);
        drop(service);
        db.pool.close().await;
        drop(db);
        let reopened = Db::open(&directory.join("test.sqlite3")).await.unwrap();
        let detail = reopened.session(&session.id).await.unwrap();
        assert_eq!(detail.generations[0].status, "completed");
        assert_eq!(
            serde_json::to_value(&detail.metrics[0]).unwrap(),
            saved_metrics
        );
        reopened.pool.close().await;
        let _ = std::fs::remove_dir_all(directory);
    }
}

#[tokio::test]
async fn observations_checkpoint_without_text_and_disconnect_keeps_them() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/v1", listener.local_addr().unwrap());
    let (release_tx, release_rx) = oneshot::channel();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let _ = request(&mut socket).await;
        socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\ndata: {\"choices\":[{\"delta\":{\"role\":\"assistant\"}}]}\n\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":12}}\n\n").await.unwrap();
        release_rx.await.unwrap();
    });
    let (db, session, directory) = setup(url).await;
    let service = ChatService::new(db.clone());
    let generation = {
        let service = service.clone();
        let session_id = session.id.clone();
        tokio::spawn(async move {
            service
                .generate(
                    GenerateInput {
                        session_id,
                        action: "send".into(),
                        content: Some("hello".into()),
                        message_id: None,
                        parameters: json!({}),
                    },
                    |_| Ok(None),
                    |_| Ok(()),
                )
                .await
        })
    };
    let progress = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let detail = db.session(&session.id).await.unwrap();
            if detail
                .metrics
                .first()
                .is_some_and(|metrics| metrics.input_tokens == Some(12))
            {
                break detail;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(progress.messages[1].content, "");
    assert_eq!(progress.generations[0].status, "streaming");
    let metrics = &progress.metrics[0];
    assert!(metrics.request_latency_ms.is_some());
    assert!(metrics.first_event_ms.is_some());
    assert_eq!(metrics.ttft_ms, None);
    assert_eq!(metrics.total_duration_ms, None);
    assert_eq!(metrics.generation_duration_ms, None);
    assert_eq!(metrics.total_tokens, None);
    assert_eq!(metrics.remaining_context, Some(988));
    release_tx.send(()).unwrap();
    server.await.unwrap();
    generation.await.unwrap().unwrap();
    let detail = db.session(&session.id).await.unwrap();
    assert_eq!(detail.generations[0].status, "failed");
    assert_eq!(
        detail.generations[0].error.as_ref().unwrap().0.code,
        "disconnected"
    );
    assert!(detail.metrics[0].total_duration_ms.unwrap() >= metrics.first_event_ms.unwrap());
    assert_eq!(
        detail.metrics[0].request_latency_ms,
        metrics.request_latency_ms
    );
    assert_eq!(detail.metrics[0].first_event_ms, metrics.first_event_ms);
    assert_eq!(detail.metrics[0].input_tokens, Some(12));
    assert_eq!(detail.metrics[0].ttft_ms, None);
    let saved_metrics = serde_json::to_value(&detail.metrics[0]).unwrap();
    drop(service);
    db.pool.close().await;
    drop(db);
    let reopened = Db::open(&directory.join("test.sqlite3")).await.unwrap();
    let detail = reopened.session(&session.id).await.unwrap();
    assert_eq!(detail.generations[0].status, "failed");
    assert_eq!(
        serde_json::to_value(&detail.metrics[0]).unwrap(),
        saved_metrics
    );
    reopened.pool.close().await;
    let _ = std::fs::remove_dir_all(directory);
}

#[tokio::test]
async fn missing_credentials_preserve_context_without_http_timings() {
    let (db, session, directory) = setup("http://127.0.0.1:1/v1".into()).await;
    let mut provider = db.providers().await.unwrap().remove(0);
    provider.authentication_mode = "bearer".into();
    db.save_provider(&provider).await.unwrap();
    let service = ChatService::new(db.clone());
    for lookup_failure in [false, true] {
        let events = Arc::new(Mutex::new(Vec::<StreamEvent>::new()));
        let output = events.clone();
        service
            .generate(
                GenerateInput {
                    session_id: session.id.clone(),
                    action: "send".into(),
                    content: Some("hello".into()),
                    message_id: None,
                    parameters: json!({}),
                },
                move |_| {
                    if lookup_failure {
                        Err(AppError::new("credentials", "Credential store unavailable"))
                    } else {
                        Ok(None)
                    }
                },
                move |event| {
                    output.lock().unwrap().push(event);
                    Ok(())
                },
            )
            .await
            .unwrap();
        let events = std::mem::take(&mut *events.lock().unwrap());
        let terminal = events.last().unwrap();
        assert_eq!(terminal.kind, "error");
        assert_eq!(
            terminal.error.as_ref().unwrap().code,
            if lookup_failure {
                "credentials"
            } else {
                "authentication"
            }
        );
        let metrics = terminal.metrics.as_ref().unwrap();
        assert_eq!(metrics.context_window, Some(1000));
        assert_eq!(metrics.request_latency_ms, None);
        assert_eq!(metrics.first_event_ms, None);
        assert_eq!(metrics.ttft_ms, None);
        assert_eq!(metrics.generation_duration_ms, None);
        assert_eq!(metrics.total_duration_ms, None);
        assert_eq!(metrics.usage_source, "unavailable");
        let detail = db.session(&session.id).await.unwrap();
        let saved = detail
            .metrics
            .iter()
            .find(|saved| saved.generation_id == metrics.generation_id)
            .unwrap();
        assert_eq!(
            serde_json::to_value(saved).unwrap(),
            serde_json::to_value(metrics).unwrap()
        );
    }
    drop(service);
    db.pool.close().await;
    drop(db);
    let _ = std::fs::remove_dir_all(directory);
}

#[tokio::test]
async fn malformed_detailed_usage_fails_without_overwriting_previous_observations() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/v1", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let _ = request(&mut socket).await;
        let body = "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":20,\"completion_tokens\":4}}\n\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":99,\"completion_tokens_details\":{\"reasoning_tokens\":-1}}}\n\ndata: [DONE]\n\n";
        socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).as_bytes()).await.unwrap();
    });
    let (db, session, directory) = setup(url).await;
    let service = ChatService::new(db.clone());
    service
        .generate(
            GenerateInput {
                session_id: session.id.clone(),
                action: "send".into(),
                content: Some("hello".into()),
                message_id: None,
                parameters: json!({}),
            },
            |_| Ok(None),
            |_| Ok(()),
        )
        .await
        .unwrap();
    server.await.unwrap();
    let detail = db.session(&session.id).await.unwrap();
    assert_eq!(detail.messages[1].content, "partial");
    assert_eq!(detail.generations[0].status, "failed");
    assert_eq!(
        detail.generations[0].error.as_ref().unwrap().0.code,
        "format"
    );
    let metrics = &detail.metrics[0];
    assert_eq!(
        (
            metrics.input_tokens,
            metrics.output_tokens,
            metrics.total_tokens
        ),
        (Some(20), Some(4), Some(24))
    );
    assert_eq!(metrics.reasoning_tokens, None);
    assert_eq!(metrics.context_usage_percent, Some(2.0));
    assert!(metrics.total_duration_ms.unwrap() >= metrics.ttft_ms.unwrap());
    drop(service);
    db.pool.close().await;
    drop(db);
    let _ = std::fs::remove_dir_all(directory);
}

#[tokio::test]
async fn http_terminal_measurement_excludes_blocked_database_time() {
    for completed in [true, false] {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/v1", listener.local_addr().unwrap());
        let (ready_tx, ready_rx) = oneshot::channel();
        let (release_tx, release_rx) = oneshot::channel();
        let (finished_tx, finished_rx) = oneshot::channel();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let _ = request(&mut socket).await;
            ready_tx.send(()).unwrap();
            release_rx.await.unwrap();
            let body = if completed {
                "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\ndata: [DONE]\n\n"
            } else {
                "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n"
            };
            socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).as_bytes()).await.unwrap();
            drop(socket);
            finished_tx.send(()).unwrap();
        });
        let (db, session, directory) = setup(url).await;
        let service = ChatService::new(db.clone());
        let started = std::time::Instant::now();
        let generation = {
            let service = service.clone();
            let session_id = session.id.clone();
            tokio::spawn(async move {
                service
                    .generate(
                        GenerateInput {
                            session_id,
                            action: "send".into(),
                            content: Some("hello".into()),
                            message_id: None,
                            parameters: json!({}),
                        },
                        |_| Ok(None),
                        |_| Ok(()),
                    )
                    .await
            })
        };
        tokio::time::timeout(std::time::Duration::from_secs(5), ready_rx)
            .await
            .unwrap()
            .unwrap();
        let mut transaction = db.pool.begin().await.unwrap();
        sqlx::query("UPDATE settings SET value = value WHERE key = 'generation'")
            .execute(&mut *transaction)
            .await
            .unwrap();
        release_tx.send(()).unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(5), finished_rx)
            .await
            .unwrap()
            .unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
        transaction.commit().await.unwrap();
        generation.await.unwrap().unwrap();
        server.await.unwrap();
        let wall_ms = started.elapsed().as_secs_f64() * 1000.0;
        let detail = db.session(&session.id).await.unwrap();
        assert_eq!(
            detail.generations[0].status,
            if completed { "completed" } else { "failed" }
        );
        let metrics = &detail.metrics[0];
        assert!(metrics.total_duration_ms.unwrap() >= metrics.ttft_ms.unwrap());
        assert!(wall_ms - metrics.total_duration_ms.unwrap() > 300.0);
        assert!(wall_ms - metrics.ttft_ms.unwrap() > 300.0);
        drop(service);
        db.pool.close().await;
        drop(db);
        let _ = std::fs::remove_dir_all(directory);
    }
}
