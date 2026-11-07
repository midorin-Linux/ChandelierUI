use std::{path::PathBuf, time::Duration};

use chandelier_core::{domain::*, infrastructure::database::Db, services::configuration::*};
use serde_json::{Value, json};
use sqlx::types::Json;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    sync::mpsc,
    task::JoinHandle,
    time::timeout,
};

struct TempDatabase {
    directory: PathBuf,
    path: PathBuf,
}
impl TempDatabase {
    fn new() -> Self {
        let directory = std::env::temp_dir().join(format!("chandelier-configuration-{}", id()));
        let path = directory.join("settings.sqlite");
        Self { directory, path }
    }
}
impl Drop for TempDatabase {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.directory);
    }
}

fn provider() -> Provider {
    Provider {
        id: id(),
        name: "Local provider".into(),
        base_url: "http://127.0.0.1:8080/v1".into(),
        authentication_mode: "none".into(),
        credential_reference: None,
        timeout_seconds: 2,
        supports_usage: true,
        default_parameters: Json(json!({})),
        created_at: -1,
    }
}
fn model(provider: &Provider, identifier: &str) -> Model {
    Model {
        id: id(),
        provider_id: provider.id.clone(),
        model_identifier: identifier.into(),
        display_name: identifier.into(),
        context_window: None,
        capabilities: Json(json!({})),
        default_parameters: Json(json!({})),
    }
}

#[tokio::test]
async fn no_auth_provider_and_model_crud_ignore_caller_credential_references() {
    let temp = TempDatabase::new();
    let db = Db::open(&temp.path).await.unwrap();
    let mut input = provider();
    input.credential_reference = Some("caller-controlled-reference-that-must-not-be-read".into());
    let mut saved = save_provider(&db, input, Some(String::new()))
        .await
        .unwrap();
    assert!(saved.credential_reference.is_none());
    assert!(saved.created_at > 0);
    let created = saved.created_at;
    saved.name = "Renamed".into();
    saved.created_at = -100;
    let saved = save_provider(&db, saved, None).await.unwrap();
    assert_eq!(saved.created_at, created);
    assert_eq!(db.providers().await.unwrap()[0].name, "Renamed");
    let mut saved_model = save_model(&db, model(&saved, "org/manual:latest"))
        .await
        .unwrap();
    saved_model.display_name = "Manual model".into();
    saved_model.context_window = Some(32768);
    saved_model.default_parameters =
        Json(json!({"temperature": 0.4, "system_prompt": "Use plain text"}));
    saved_model.capabilities =
        Json(json!({"unsupported_parameters": ["top_p"], "max_tokens_parameter": "max_tokens"}));
    let updated = save_model(&db, saved_model.clone()).await.unwrap();
    assert_eq!(updated.context_window, Some(32768));
    assert_eq!(
        db.models().await.unwrap()[0].capabilities.0,
        saved_model.capabilities.0
    );
    let session = db.create_session("Selected model").await.unwrap();
    db.update_session(
        &session.id,
        &session.title,
        Some(&saved_model.id),
        &json!({}),
    )
    .await
    .unwrap();
    delete_provider(&db, &saved.id).await.unwrap();
    assert!(db.models().await.unwrap().is_empty());
    assert!(db.providers().await.unwrap().is_empty());
    assert!(
        db.session(&session.id)
            .await
            .unwrap()
            .session
            .selected_model_id
            .is_none()
    );
    assert_eq!(
        delete_provider(&db, &saved.id).await.unwrap_err().code,
        "not_found"
    );
    assert_eq!(
        test_provider(&db, "missing").await.unwrap_err().code,
        "not_found"
    );
    assert_eq!(
        refresh_models(&db, "missing").await.unwrap_err().code,
        "not_found"
    );
    db.pool.close().await;
}

#[tokio::test]
async fn provider_validation_rejects_unsafe_configuration_before_using_credentials() {
    let temp = TempDatabase::new();
    let db = Db::open(&temp.path).await.unwrap();
    for url in [
        "file:///tmp/api",
        "https://user:password@example.com/v1",
        "https://example.com/v1?api_key=secret",
        "http://example.com/#fragment",
        "http://example.com/with space",
    ] {
        let mut invalid = provider();
        invalid.base_url = url.into();
        assert_eq!(
            save_provider(&db, invalid, None).await.unwrap_err().code,
            "validation"
        );
    }
    let mut invalid = provider();
    invalid.name = " \n ".into();
    assert_eq!(
        save_provider(&db, invalid, None).await.unwrap_err().code,
        "validation"
    );
    let mut invalid = provider();
    invalid.timeout_seconds = 0;
    assert_eq!(
        save_provider(&db, invalid, None).await.unwrap_err().code,
        "validation"
    );
    let mut invalid = provider();
    invalid.default_parameters = Json(json!({"api_key": "must-not-persist"}));
    assert_eq!(
        save_provider(&db, invalid, None).await.unwrap_err().code,
        "validation"
    );
    let mut invalid = provider();
    invalid.default_parameters = Json(json!({"temperature": 3}));
    assert_eq!(
        save_provider(&db, invalid, None).await.unwrap_err().code,
        "validation"
    );
    assert_eq!(
        save_provider(&db, provider(), Some("key-for-no-auth".into()))
            .await
            .unwrap_err()
            .code,
        "validation"
    );
    let mut bearer = provider();
    bearer.authentication_mode = "bearer".into();
    bearer.credential_reference = Some("forged-reference".into());
    for key in [None, Some(String::new())] {
        assert_eq!(
            save_provider(&db, bearer.clone(), key)
                .await
                .unwrap_err()
                .code,
            "authentication"
        );
    }
    assert_eq!(
        save_provider(&db, bearer, Some("invalid\r\nkey".into()))
            .await
            .unwrap_err()
            .code,
        "validation"
    );
    assert!(db.providers().await.unwrap().is_empty());
    db.pool.close().await;
}

#[tokio::test]
async fn model_validation_and_identity_protection_apply_without_history() {
    let temp = TempDatabase::new();
    let db = Db::open(&temp.path).await.unwrap();
    let provider = save_provider(&db, provider(), None).await.unwrap();
    let original = save_model(&db, model(&provider, "original")).await.unwrap();
    let duplicate = model(&provider, "original");
    assert_eq!(
        save_model(&db, duplicate).await.unwrap_err().code,
        "conflict"
    );
    for capabilities in [
        json!([]),
        json!({"streaming": true}),
        json!({"unsupported_parameters": ["system_prompt"]}),
        json!({"unsupported_parameters": ["unknown"]}),
        json!({"unsupported_parameters": [1]}),
        json!({"unsupported_parameters": null}),
        json!({"max_tokens_parameter": "tokens"}),
    ] {
        let mut invalid = original.clone();
        invalid.capabilities = Json(capabilities);
        assert_eq!(
            save_model(&db, invalid).await.unwrap_err().code,
            "validation"
        );
    }
    for context in [Some(0), Some(-1), Some(i64::MAX)] {
        let mut invalid = original.clone();
        invalid.context_window = context;
        assert_eq!(
            save_model(&db, invalid).await.unwrap_err().code,
            "validation"
        );
    }
    for identifier in ["", "model with spaces", "model\n"] {
        let mut invalid = original.clone();
        invalid.model_identifier = identifier.into();
        assert_eq!(
            save_model(&db, invalid).await.unwrap_err().code,
            "validation"
        );
    }
    let mut changed = original.clone();
    changed.model_identifier = "different-identity".into();
    assert_eq!(
        save_model(&db, changed).await.unwrap_err().code,
        "validation"
    );
    let mut missing = model(&provider, "missing-provider");
    missing.provider_id = id();
    assert_eq!(
        save_model(&db, missing).await.unwrap_err().code,
        "not_found"
    );
    let mut invalid = original.clone();
    invalid.display_name = " ".into();
    assert_eq!(
        save_model(&db, invalid).await.unwrap_err().code,
        "validation"
    );
    let mut invalid = original.clone();
    invalid.default_parameters = Json(json!({"max_completion_tokens": 0}));
    assert_eq!(
        save_model(&db, invalid).await.unwrap_err().code,
        "validation"
    );
    assert_eq!(
        db.models().await.unwrap()[0].model_identifier,
        original.model_identifier
    );
    db.pool.close().await;
}

#[tokio::test]
async fn defaults_validation_atomic_updates_and_last_model_survive_reopening() {
    let temp = TempDatabase::new();
    let db = Db::open(&temp.path).await.unwrap();
    assert_eq!(
        bootstrap_settings(&db).await.unwrap(),
        json!({
            "theme": "system", "chat_width": 880, "font_size": 15, "auto_scroll": true,
            "log_level": "info", "generation": {}, "last_model_id": null,
        })
    );
    let provider = save_provider(&db, provider(), None).await.unwrap();
    let selected = save_model(&db, model(&provider, "selected")).await.unwrap();
    remember_model(&db, Some(&selected.id)).await.unwrap();
    let settings = save_settings(
        &db,
        &json!({"theme": "dark", "font_size": 16, "last_model_id": "untrusted-old-selection"}),
    )
    .await
    .unwrap();
    assert_eq!(settings["last_model_id"], selected.id);
    assert_eq!(settings["chat_width"], 880);
    for invalid in [
        json!(null),
        json!({"unknown": true}),
        json!({"api_key": "secret"}),
        json!({"theme": "auto"}),
        json!({"chat_width": 479}),
        json!({"chat_width": 1601}),
        json!({"chat_width": 880.5}),
        json!({"font_size": 11}),
        json!({"font_size": 29}),
        json!({"auto_scroll": "true"}),
        json!({"log_level": "verbose"}),
        json!({"generation": {"temperature": 3}}),
    ] {
        assert_eq!(
            save_settings(&db, &invalid).await.unwrap_err().code,
            "validation"
        );
    }
    let before = db.settings().await.unwrap();
    sqlx::query("CREATE TRIGGER reject_theme BEFORE UPDATE ON settings WHEN NEW.key = 'theme' BEGIN SELECT RAISE(ABORT, 'test_failure'); END")
        .execute(&db.pool).await.unwrap();
    assert!(
        save_settings(&db, &json!({"font_size": 20, "theme": "light"}))
            .await
            .is_err()
    );
    assert_eq!(db.settings().await.unwrap(), before);
    sqlx::query("DROP TRIGGER reject_theme")
        .execute(&db.pool)
        .await
        .unwrap();
    let editable_settings = json!({"theme": "light", "last_model_id": null});
    let (editable, remembered) = tokio::join!(
        save_settings(&db, &editable_settings),
        remember_model(&db, Some(&selected.id)),
    );
    editable.unwrap();
    remembered.unwrap();
    assert_eq!(
        bootstrap_settings(&db).await.unwrap()["last_model_id"],
        selected.id
    );
    assert_eq!(
        remember_model(&db, Some("missing")).await.unwrap_err().code,
        "not_found"
    );
    db.pool.close().await;
    let reopened = Db::open(&temp.path).await.unwrap();
    let settings = bootstrap_settings(&reopened).await.unwrap();
    assert_eq!(settings["last_model_id"], selected.id);
    assert_eq!(settings["theme"], "light");
    assert_eq!(settings["font_size"], 16);
    remember_model(&reopened, None).await.unwrap();
    assert!(bootstrap_settings(&reopened).await.unwrap()["last_model_id"].is_null());
    assert_eq!(
        bootstrap_settings(&reopened).await.unwrap()["theme"],
        "light"
    );
    for settings in [
        json!({"chat_width": 480, "font_size": 12, "log_level": "off", "auto_scroll": false}),
        json!({"chat_width": 1600, "font_size": 28, "log_level": "trace", "generation": {"system_prompt": "", "temperature": 2, "top_p": 1, "max_completion_tokens": 1, "frequency_penalty": -2, "presence_penalty": 2}}),
    ] {
        save_settings(&reopened, &settings).await.unwrap();
    }
    reopened.pool.close().await;
}

struct Mock {
    root: String,
    requests: mpsc::Receiver<String>,
    task: JoinHandle<()>,
}
impl Drop for Mock {
    fn drop(&mut self) {
        self.task.abort();
    }
}
async fn mock_models(bodies: Vec<Value>) -> Mock {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let root = format!("http://{}/v1", listener.local_addr().unwrap());
    let (sender, requests) = mpsc::channel(4);
    let task = tokio::spawn(async move {
        for body in bodies {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            while !request.windows(4).any(|window| window == b"\r\n\r\n") {
                let mut bytes = [0; 4096];
                let count = socket.read(&mut bytes).await.unwrap();
                assert!(count > 0 && request.len() < 65536);
                request.extend_from_slice(&bytes[.. count]);
            }
            sender
                .send(String::from_utf8(request).unwrap())
                .await
                .unwrap();
            let body = body.to_string();
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            socket.write_all(response.as_bytes()).await.unwrap();
        }
    });
    Mock {
        root,
        requests,
        task,
    }
}

#[tokio::test]
async fn discovery_deduplicates_preserves_manual_metadata_and_keeps_stale_models() {
    let temp = TempDatabase::new();
    let db = Db::open(&temp.path).await.unwrap();
    let response = json!({"data": [{"id": "configured", "context_length": 999999}, {"id": "new"}, {"id": "new"}]});
    let mut server = mock_models(vec![
        response.clone(),
        response,
        json!({"data": [{"id": "new"}]}),
    ])
    .await;
    let mut config = provider();
    config.base_url = server.root.clone();
    let config = save_provider(&db, config, None).await.unwrap();
    let mut configured = model(&config, "configured");
    configured.display_name = "Custom display".into();
    configured.context_window = Some(8192);
    configured.default_parameters = Json(json!({"temperature": 0.25}));
    configured.capabilities =
        Json(json!({"unsupported_parameters": ["top_p"], "max_tokens_parameter": "max_tokens"}));
    let configured = save_model(&db, configured).await.unwrap();
    let stale = save_model(&db, model(&config, "manual-not-discovered"))
        .await
        .unwrap();
    test_provider(&db, &config.id).await.unwrap();
    assert_eq!(db.models().await.unwrap().len(), 2);
    let discovered = refresh_models(&db, &config.id).await.unwrap();
    assert_eq!(discovered.len(), 3);
    let preserved = discovered
        .iter()
        .find(|model| model.id == configured.id)
        .unwrap();
    assert_eq!(preserved.display_name, configured.display_name);
    assert_eq!(preserved.context_window, configured.context_window);
    assert_eq!(
        preserved.default_parameters.0,
        configured.default_parameters.0
    );
    assert_eq!(preserved.capabilities.0, configured.capabilities.0);
    assert!(discovered.iter().any(|model| model.id == stale.id));
    let new = discovered
        .iter()
        .find(|model| model.model_identifier == "new")
        .unwrap();
    assert!(new.context_window.is_none());
    assert_eq!(new.capabilities.0, json!({}));
    assert_eq!(new.default_parameters.0, json!({}));
    let refreshed = refresh_models(&db, &config.id).await.unwrap();
    assert_eq!(refreshed.len(), 3);
    assert_eq!(
        refreshed
            .iter()
            .find(|model| model.model_identifier == "new")
            .unwrap()
            .id,
        new.id
    );
    for _ in 0 .. 3 {
        let request = timeout(Duration::from_secs(3), server.requests.recv())
            .await
            .unwrap()
            .unwrap();
        assert!(request.starts_with("GET /v1/models HTTP/1.1\r\n"));
        assert!(!request.to_ascii_lowercase().contains("authorization:"));
    }
    db.pool.close().await;
}

#[tokio::test]
async fn history_identity_and_delete_guards_run_before_credential_access() {
    let temp = TempDatabase::new();
    let db = Db::open(&temp.path).await.unwrap();
    let config = save_provider(&db, provider(), None).await.unwrap();
    let original = save_model(&db, model(&config, "historical-model"))
        .await
        .unwrap();
    let other_provider = save_provider(&db, provider(), None).await.unwrap();
    let session = db.create_session("History").await.unwrap();
    let input = GenerateInput {
        session_id: session.id.clone(),
        action: "send".into(),
        content: Some("Question".into()),
        message_id: None,
        parameters: json!({}),
    };
    let snapshot = json!({"model": original.model_identifier, "provider": config.id});
    let (_, generation) = db
        .begin_generation(&input, &config, &original, &json!({}), &snapshot)
        .await
        .unwrap();
    // A fake stored reference ensures precondition failures cannot reach any real OS keyring.
    let mut bearer = config.clone();
    bearer.authentication_mode = "bearer".into();
    bearer.credential_reference = Some("deliberately-unavailable-history-key".into());
    db.save_provider(&bearer).await.unwrap();
    assert_eq!(
        delete_provider(&db, &config.id).await.unwrap_err().code,
        "generation_active"
    );
    assert_eq!(
        db.delete_model(&original.id).await.unwrap_err().code,
        "generation_active"
    );
    let metrics = GenerationMetrics {
        generation_id: generation.id.clone(),
        usage_source: "unavailable".into(),
        ..Default::default()
    };
    db.final_generation(
        &generation.id,
        "Answer",
        "completed",
        Some("stop"),
        None,
        &metrics,
    )
    .await
    .unwrap();
    let mut moved = original.clone();
    moved.provider_id = other_provider.id;
    assert_eq!(save_model(&db, moved).await.unwrap_err().code, "validation");
    let mut changed = original.clone();
    changed.model_identifier = "misleading-new-identity".into();
    assert_eq!(
        save_model(&db, changed).await.unwrap_err().code,
        "validation"
    );
    let mut renamed = original.clone();
    renamed.display_name = "New presentation, same identity".into();
    save_model(&db, renamed).await.unwrap();
    let unused = save_model(&db, model(&config, "unused-model"))
        .await
        .unwrap();
    assert_eq!(
        delete_provider(&db, &config.id).await.unwrap_err().code,
        "referenced_data"
    );
    assert_eq!(
        db.delete_model(&original.id).await.unwrap_err().code,
        "referenced_data"
    );
    assert!(db.models().await.unwrap().iter().any(|m| m.id == unused.id));
    let detail = db.session(&session.id).await.unwrap();
    assert_eq!(detail.generations[0].request_snapshot.0, snapshot);
    assert_eq!(detail.generations[0].model_id, original.id);
    assert_eq!(
        db.providers()
            .await
            .unwrap()
            .iter()
            .find(|p| p.id == config.id)
            .unwrap()
            .credential_reference,
        bearer.credential_reference
    );
    db.pool.close().await;
}
