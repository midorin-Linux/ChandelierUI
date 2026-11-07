use std::path::PathBuf;

use chandelier_core::{domain::*, infrastructure::database::Db};
use serde_json::json;
use sqlx::{Connection, migrate::Migrate, sqlite::SqliteConnectOptions, types::Json};

struct TempDatabase {
    directory: PathBuf,
    path: PathBuf,
}

impl TempDatabase {
    fn new() -> Self {
        let directory = std::env::temp_dir().join(format!("chandelier-test-{}", id()));
        let path = directory
            .join("日本語 # directory")
            .join("conversation #1.sqlite");
        Self { directory, path }
    }
}
impl Drop for TempDatabase {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.directory);
    }
}

async fn configured(db: &Db) -> (Provider, Model) {
    let provider = Provider {
        id: id(),
        name: "Local provider".into(),
        base_url: "http://127.0.0.1:8080/v1".into(),
        authentication_mode: "none".into(),
        credential_reference: None,
        timeout_seconds: 60,
        supports_usage: true,
        default_parameters: Json(json!({"temperature": 0.5})),
        created_at: now(),
    };
    let model = Model {
        id: id(),
        provider_id: provider.id.clone(),
        model_identifier: "test-model".into(),
        display_name: "Test model".into(),
        context_window: Some(8192),
        capabilities: Json(json!({"streaming": true})),
        default_parameters: Json(json!({})),
    };
    db.save_provider(&provider).await.unwrap();
    db.save_model(&model).await.unwrap();
    (provider, model)
}

fn input(
    session_id: &str,
    action: &str,
    content: Option<&str>,
    message_id: Option<&str>,
) -> GenerateInput {
    GenerateInput {
        session_id: session_id.into(),
        action: action.into(),
        content: content.map(str::to_owned),
        message_id: message_id.map(str::to_owned),
        parameters: json!({}),
    }
}

fn metrics(generation_id: &str) -> GenerationMetrics {
    GenerationMetrics {
        generation_id: generation_id.into(),
        request_latency_ms: Some(8.0),
        first_event_ms: Some(10.0),
        ttft_ms: Some(12.0),
        generation_duration_ms: Some(100.0),
        total_duration_ms: Some(112.0),
        input_tokens: Some(20),
        output_tokens: Some(5),
        total_tokens: Some(25),
        cached_tokens: Some(2),
        reasoning_tokens: Some(1),
        context_window: Some(8192),
        output_tps: Some(50.0),
        generation_throughput: Some(50.0),
        context_usage_percent: Some(25.0 / 8192.0 * 100.0),
        remaining_context: Some(8192 - 25),
        usage_source: "provider".into(),
    }
}

async fn begin(
    db: &Db,
    session_id: &str,
    provider: &Provider,
    model: &Model,
    text: &str,
) -> (Message, Generation) {
    db.begin_generation(
        &input(session_id, "send", Some(text), None),
        provider,
        model,
        &json!({"temperature": 0.5}),
        &json!({"messages": [{"role": "user", "content": text}], "model": model.model_identifier}),
    )
    .await
    .unwrap()
}

async fn complete(db: &Db, generation: &Generation, content: &str) {
    db.final_generation(
        &generation.id,
        content,
        "completed",
        Some("stop"),
        None,
        &metrics(&generation.id),
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn crud_settings_foreign_keys_and_reopen() {
    let temp = TempDatabase::new();
    let db = Db::open(&temp.path).await.unwrap();
    assert!(db.sessions().await.unwrap().is_empty());
    assert_eq!(db.settings().await.unwrap(), json!({}));
    let journal: String = sqlx::query_scalar("PRAGMA journal_mode")
        .fetch_one(&db.pool)
        .await
        .unwrap();
    let foreign_keys: i64 = sqlx::query_scalar("PRAGMA foreign_keys")
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert_eq!(journal, "wal");
    assert_eq!(foreign_keys, 1);
    assert_eq!(
        db.create_session("  \n ").await.unwrap_err().code,
        "validation"
    );
    assert_eq!(
        db.create_session(&"題".repeat(201)).await.unwrap_err().code,
        "validation"
    );
    let first = db
        .create_session("  First ' ; DROP TABLE sessions; --  ")
        .await
        .unwrap();
    assert_eq!(first.title, "First ' ; DROP TABLE sessions; --");
    let second = db.create_session("Second").await.unwrap();
    let (mut provider, mut model) = configured(&db).await;
    provider.name = "Renamed provider".into();
    provider.authentication_mode = "bearer".into();
    provider.credential_reference = Some(format!("chandelier/provider/{}", provider.id));
    db.save_provider(&provider).await.unwrap();
    model.display_name = "Renamed model".into();
    db.save_model(&model).await.unwrap();
    let updated = db
        .update_session(
            &first.id,
            " Renamed ",
            Some(&model.id),
            &json!({"temperature": 0.2}),
        )
        .await
        .unwrap();
    assert_eq!(updated.title, "Renamed");
    assert_eq!(updated.created_at, first.created_at);
    assert_eq!(
        updated.selected_model_id.as_deref(),
        Some(model.id.as_str())
    );
    assert_eq!(
        db.update_session(&first.id, "Renamed", Some("missing"), &json!({}))
            .await
            .unwrap_err()
            .code,
        "referenced_data"
    );
    assert_eq!(db.session("missing").await.unwrap_err().code, "not_found");
    assert_eq!(
        db.delete_session("missing").await.unwrap_err().code,
        "not_found"
    );
    let mut invalid_model = model.clone();
    invalid_model.id = id();
    invalid_model.provider_id = "missing".into();
    assert_eq!(
        db.save_model(&invalid_model).await.unwrap_err().code,
        "referenced_data"
    );
    db.set_settings(
        &json!({"theme": "dark", "nested": {"enabled": true}, "number": 3, "nullable": null}),
    )
    .await
    .unwrap();
    db.set_settings(&json!({"theme": "light", "nested": {"enabled": false}}))
        .await
        .unwrap();
    // Set distinct timestamps without sleeping so ordering does not depend on clock resolution.
    sqlx::query("UPDATE sessions SET updated_at = CASE WHEN id = ? THEN 20 ELSE 10 END")
        .bind(&first.id)
        .execute(&db.pool)
        .await
        .unwrap();
    assert_eq!(db.sessions().await.unwrap()[0].id, first.id);
    db.pool.close().await;

    let reopened = Db::open(&temp.path).await.unwrap();
    let detail = reopened.session(&first.id).await.unwrap();
    assert_eq!(
        detail.session.session_settings.0,
        json!({"temperature": 0.2})
    );
    assert!(detail.messages.is_empty());
    assert_eq!(
        reopened.providers().await.unwrap()[0].name,
        "Renamed provider"
    );
    assert_eq!(
        reopened.models().await.unwrap()[0].display_name,
        "Renamed model"
    );
    assert_eq!(
        reopened.settings().await.unwrap(),
        json!({"theme": "light", "nested": {"enabled": false}})
    );
    reopened.delete_model(&model.id).await.unwrap();
    assert!(
        reopened
            .session(&first.id)
            .await
            .unwrap()
            .session
            .selected_model_id
            .is_none()
    );
    reopened.delete_provider(&provider.id).await.unwrap();
    reopened.delete_session(&first.id).await.unwrap();
    reopened.delete_session(&second.id).await.unwrap();
    assert!(reopened.sessions().await.unwrap().is_empty());
    reopened.pool.close().await;
}

#[tokio::test]
async fn regenerate_and_edit_preserve_archived_text_snapshots_and_metrics() {
    let temp = TempDatabase::new();
    let db = Db::open(&temp.path).await.unwrap();
    let (provider, model) = configured(&db).await;
    let session = db.create_session("History").await.unwrap();
    assert!(
        db.begin_generation(
            &input(&session.id, "regenerate", None, None),
            &provider,
            &model,
            &json!({}),
            &json!({})
        )
        .await
        .is_err()
    );
    let (original_assistant, original_generation) =
        begin(&db, &session.id, &provider, &model, "Original question").await;
    complete(&db, &original_generation, "Original answer").await;
    let original_user = db.session(&session.id).await.unwrap().messages[0].clone();
    let (_, regenerated) = db
        .begin_generation(
            &input(&session.id, "regenerate", None, None),
            &provider,
            &model,
            &json!({"temperature": 0.7}),
            &json!({"version": 2, "messages": [{"role": "user", "content": "Original question"}]}),
        )
        .await
        .unwrap();
    complete(&db, &regenerated, "Replacement answer").await;
    let detail = db.session(&session.id).await.unwrap();
    assert_eq!(detail.messages.len(), 2);
    assert_eq!(detail.messages[0].id, original_user.id);
    assert_eq!(detail.messages[1].content, "Replacement answer");
    assert_eq!(detail.generations.len(), 2);
    let archived: Message = sqlx::query_as("SELECT * FROM messages WHERE id = ?")
        .bind(&original_assistant.id)
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert!(!archived.active);
    assert_eq!(archived.content, "Original answer");
    let (_, later) = begin(&db, &session.id, &provider, &model, "Follow-up").await;
    complete(&db, &later, "Later answer").await;
    let (_, edited) = db
        .begin_generation(
            &input(
                &session.id,
                "edit",
                Some("Edited question"),
                Some(&original_user.id),
            ),
            &provider,
            &model,
            &json!({"temperature": 0.1}),
            &json!({"version": 3}),
        )
        .await
        .unwrap();
    complete(&db, &edited, "Edited answer").await;
    let detail = db.session(&session.id).await.unwrap();
    assert_eq!(
        detail
            .messages
            .iter()
            .map(|message| message.content.as_str())
            .collect::<Vec<_>>(),
        ["Edited question", "Edited answer"]
    );
    assert_eq!(
        detail
            .messages
            .iter()
            .map(|message| message.ordinal)
            .collect::<Vec<_>>(),
        [0, 1]
    );
    assert_eq!(detail.generations.len(), 4);
    assert_eq!(detail.metrics.len(), 4);
    let saved_original = detail
        .generations
        .iter()
        .find(|generation| generation.id == original_generation.id)
        .unwrap();
    assert_eq!(
        saved_original.request_snapshot.0,
        original_generation.request_snapshot.0
    );
    assert_eq!(
        saved_original.request_parameters.0,
        json!({"temperature": 0.5})
    );
    assert_eq!(saved_original.provider_id, provider.id);
    assert_eq!(saved_original.model_id, model.id);
    let old_user: Message = sqlx::query_as("SELECT * FROM messages WHERE id = ?")
        .bind(&original_user.id)
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert!(!old_user.active);
    assert_eq!(old_user.content, "Original question");
    let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM messages WHERE session_id = ?")
        .bind(&session.id)
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert_eq!(total, 7);
    assert!(
        sqlx::query("UPDATE generations SET request_snapshot = '{}' WHERE id = ?")
            .bind(&original_generation.id)
            .execute(&db.pool)
            .await
            .is_err()
    );
    assert_eq!(
        db.delete_model(&model.id).await.unwrap_err().code,
        "referenced_data"
    );
    assert_eq!(
        db.delete_provider(&provider.id).await.unwrap_err().code,
        "referenced_data"
    );
    db.pool.close().await;

    let reopened = Db::open(&temp.path).await.unwrap();
    let detail = reopened.session(&session.id).await.unwrap();
    assert_eq!(detail.generations.len(), 4);
    assert_eq!(detail.metrics.len(), 4);
    assert_eq!(detail.messages[0].content, "Edited question");
    reopened.delete_session(&session.id).await.unwrap();
    for table in ["messages", "generations", "generation_metrics"] {
        let count: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
            .fetch_one(&reopened.pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
    }
    reopened.delete_model(&model.id).await.unwrap();
    reopened.delete_provider(&provider.id).await.unwrap();
    reopened.pool.close().await;
}

#[tokio::test]
async fn concurrent_generation_guard_checkpoint_and_cancellation_are_consistent() {
    let temp = TempDatabase::new();
    let db = Db::open(&temp.path).await.unwrap();
    let (provider, model) = configured(&db).await;
    let session = db.create_session("Concurrent").await.unwrap();
    let request = input(&session.id, "send", Some("Question"), None);
    let parameters = json!({});
    let snapshot = json!({"messages": []});
    let (left, right) = tokio::join!(
        db.begin_generation(&request, &provider, &model, &parameters, &snapshot),
        db.begin_generation(&request, &provider, &model, &parameters, &snapshot),
    );
    let generation = match (left, right) {
        (Ok((_, generation)), Err(error)) | (Err(error), Ok((_, generation))) => {
            assert_eq!(error.code, "generation_active");
            generation
        }
        _ => panic!("exactly one generation must start"),
    };
    assert_eq!(db.session(&session.id).await.unwrap().messages.len(), 2);
    assert_eq!(
        db.update_session(&session.id, "Changed", None, &json!({}))
            .await
            .unwrap_err()
            .code,
        "generation_active"
    );
    assert_eq!(
        db.delete_session(&session.id).await.unwrap_err().code,
        "generation_active"
    );
    assert_eq!(
        db.delete_provider(&provider.id).await.unwrap_err().code,
        "generation_active"
    );
    assert_eq!(
        db.delete_model(&model.id).await.unwrap_err().code,
        "generation_active"
    );

    // The partial index protects the invariant even when callers bypass the high-level API.
    let mut tx = db.pool.begin().await.unwrap();
    let extra_message_id = id();
    sqlx::query("INSERT INTO messages (id, session_id, role, content, status, created_at, updated_at, ordinal) VALUES (?, ?, 'assistant', '', 'pending', 0, 0, 2)")
        .bind(&extra_message_id).bind(&session.id).execute(&mut *tx).await.unwrap();
    let duplicate = sqlx::query("INSERT INTO generations (id, session_id, message_id, provider_id, model_id, status, request_parameters, request_snapshot, started_at) SELECT ?, session_id, ?, provider_id, model_id, 'pending', request_parameters, request_snapshot, started_at FROM generations WHERE id = ?")
        .bind(id()).bind(extra_message_id).bind(&generation.id).execute(&mut *tx).await.unwrap_err();
    assert!(duplicate.as_database_error().unwrap().is_unique_violation());
    tx.rollback().await.unwrap();

    db.checkpoint(&generation.id, "Partial 日本語")
        .await
        .unwrap();
    let detail = db.session(&session.id).await.unwrap();
    assert_eq!(detail.generations[0].status, "streaming");
    assert_eq!(detail.messages[1].status, "streaming");
    assert_eq!(detail.messages[1].content, "Partial 日本語");
    assert_eq!(
        db.delete_session(&session.id).await.unwrap_err().code,
        "generation_active"
    );
    let mut saved_metrics = metrics(&generation.id);
    db.save_metrics(&saved_metrics).await.unwrap();
    saved_metrics.output_tokens = Some(7);
    db.final_generation(
        &generation.id,
        "Partial 日本語",
        "cancelled",
        Some("cancelled"),
        None,
        &saved_metrics,
    )
    .await
    .unwrap();
    assert_eq!(
        db.checkpoint(&generation.id, "must not overwrite")
            .await
            .unwrap_err()
            .code,
        "generation_not_active"
    );
    assert_eq!(
        db.final_generation(
            &generation.id,
            "must not overwrite",
            "completed",
            None,
            None,
            &saved_metrics
        )
        .await
        .unwrap_err()
        .code,
        "generation_not_active"
    );
    db.pool.close().await;
    let reopened = Db::open(&temp.path).await.unwrap();
    let detail = reopened.session(&session.id).await.unwrap();
    assert_eq!(detail.messages[1].status, "cancelled");
    assert_eq!(detail.messages[1].content, "Partial 日本語");
    assert_eq!(
        detail.generations[0].finish_reason.as_deref(),
        Some("cancelled")
    );
    assert!(detail.generations[0].finished_at.is_some());
    assert_eq!(
        serde_json::to_value(&detail.metrics[0]).unwrap(),
        serde_json::to_value(saved_metrics).unwrap()
    );
    reopened
        .update_session(&session.id, "Allowed again", None, &json!({}))
        .await
        .unwrap();
    reopened.pool.close().await;
}

#[tokio::test]
async fn startup_recovers_pending_and_streaming_without_losing_text_or_metrics() {
    let temp = TempDatabase::new();
    let db = Db::open(&temp.path).await.unwrap();
    let (provider, model) = configured(&db).await;
    let pending_session = db.create_session("Pending").await.unwrap();
    let streaming_session = db.create_session("Streaming").await.unwrap();
    let complete_session = db.create_session("Completed").await.unwrap();
    let (_, pending) = begin(
        &db,
        &pending_session.id,
        &provider,
        &model,
        "Pending question",
    )
    .await;
    let (_, streaming) = begin(
        &db,
        &streaming_session.id,
        &provider,
        &model,
        "Streaming question",
    )
    .await;
    db.checkpoint(&streaming.id, "Persisted partial answer")
        .await
        .unwrap();
    db.save_metrics(&metrics(&streaming.id)).await.unwrap();
    let (_, completed) = begin(
        &db,
        &complete_session.id,
        &provider,
        &model,
        "Completed question",
    )
    .await;
    complete(&db, &completed, "Completed answer").await;
    db.pool.close().await;

    let reopened = Db::open(&temp.path).await.unwrap();
    for (session_id, generation_id, content) in [
        (&pending_session.id, &pending.id, ""),
        (
            &streaming_session.id,
            &streaming.id,
            "Persisted partial answer",
        ),
    ] {
        let detail = reopened.session(session_id).await.unwrap();
        assert_eq!(detail.messages[1].status, "failed");
        assert_eq!(detail.messages[1].content, content);
        assert_eq!(detail.messages[0].status, "completed");
        let recovered = &detail.generations[0];
        assert_eq!(&recovered.id, generation_id);
        assert_eq!(recovered.status, "failed");
        assert_eq!(recovered.finish_reason.as_deref(), Some("interrupted"));
        assert_eq!(recovered.error.as_ref().unwrap().0.code, "interrupted");
        assert!(recovered.finished_at.is_some());
    }
    assert_eq!(
        reopened
            .session(&streaming_session.id)
            .await
            .unwrap()
            .metrics[0]
            .output_tokens,
        Some(5)
    );
    let complete_detail = reopened.session(&complete_session.id).await.unwrap();
    assert_eq!(complete_detail.generations[0].status, "completed");
    assert_eq!(complete_detail.messages[1].content, "Completed answer");
    let (_, regenerated) = reopened
        .begin_generation(
            &input(&streaming_session.id, "regenerate", None, None),
            &provider,
            &model,
            &json!({}),
            &json!({"recovered": true}),
        )
        .await
        .unwrap();
    complete(&reopened, &regenerated, "Recovered new answer").await;
    reopened.pool.close().await;
    let again = Db::open(&temp.path).await.unwrap();
    let detail = again.session(&streaming_session.id).await.unwrap();
    assert_eq!(detail.generations.len(), 2);
    assert_eq!(detail.messages[1].content, "Recovered new answer");
    assert_eq!(
        detail
            .generations
            .iter()
            .find(|generation| generation.id == streaming.id)
            .unwrap()
            .request_snapshot
            .0,
        streaming.request_snapshot.0
    );
    again.pool.close().await;
}

#[tokio::test]
async fn migrates_existing_first_version_and_preserves_rows() {
    static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");
    let temp = TempDatabase::new();
    std::fs::create_dir_all(temp.path.parent().unwrap()).unwrap();
    let options = SqliteConnectOptions::new()
        .filename(&temp.path)
        .create_if_missing(true)
        .foreign_keys(true);
    let mut connection = sqlx::SqliteConnection::connect_with(&options)
        .await
        .unwrap();
    connection.ensure_migrations_table().await.unwrap();
    let first = MIGRATOR
        .iter()
        .find(|migration| migration.version == 1)
        .unwrap();
    connection.apply(first).await.unwrap();
    sqlx::query("INSERT INTO sessions (id, title, created_at, updated_at) VALUES ('existing', '保存済み', 10, 20)")
        .execute(&mut connection).await.unwrap();
    sqlx::query("INSERT INTO settings (key, value) VALUES ('theme', '\"dark\"')")
        .execute(&mut connection)
        .await
        .unwrap();
    connection.close().await.unwrap();
    let db = Db::open(&temp.path).await.unwrap();
    let detail = db.session("existing").await.unwrap();
    assert_eq!(detail.session.title, "保存済み");
    assert_eq!(detail.session.created_at, 10);
    assert_eq!(detail.session.updated_at, 20);
    assert_eq!(db.settings().await.unwrap(), json!({"theme": "dark"}));
    let (provider, model) = configured(&db).await;
    let duplicate = Model {
        id: id(),
        ..model.clone()
    };
    assert_eq!(
        db.save_model(&duplicate).await.unwrap_err().code,
        "conflict"
    );
    assert_eq!(
        db.models()
            .await
            .unwrap()
            .iter()
            .filter(|m| m.provider_id == provider.id)
            .count(),
        1
    );
    db.pool.close().await;
    let reopened = Db::open(&temp.path).await.unwrap();
    assert_eq!(
        reopened.session("existing").await.unwrap().session.title,
        "保存済み"
    );
    reopened.pool.close().await;
}

#[tokio::test]
async fn failed_generation_writes_and_settings_replace_roll_back_atomically() {
    let temp = TempDatabase::new();
    let db = Db::open(&temp.path).await.unwrap();
    let (provider, model) = configured(&db).await;
    let session = db.create_session("Rollback").await.unwrap();
    let (_, original) = begin(&db, &session.id, &provider, &model, "Original question").await;
    complete(&db, &original, "Original answer").await;
    let original_detail = db.session(&session.id).await.unwrap();
    sqlx::query("CREATE TRIGGER reject_new_generation BEFORE INSERT ON generations BEGIN SELECT RAISE(ABORT, 'injected_failure'); END")
        .execute(&db.pool).await.unwrap();
    for request in [
        input(&session.id, "send", Some("Must roll back user"), None),
        input(&session.id, "regenerate", None, None),
        input(
            &session.id,
            "edit",
            Some("Must roll back edit"),
            Some(&original_detail.messages[0].id),
        ),
    ] {
        assert!(
            db.begin_generation(&request, &provider, &model, &json!({}), &json!({}))
                .await
                .is_err()
        );
        let detail = db.session(&session.id).await.unwrap();
        assert_eq!(detail.messages.len(), 2);
        assert_eq!(detail.messages[0].id, original_detail.messages[0].id);
        assert_eq!(detail.messages[1].id, original_detail.messages[1].id);
        assert_eq!(detail.generations.len(), 1);
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM messages")
            .fetch_one(&db.pool)
            .await
            .unwrap();
        assert_eq!(count, 2);
    }
    sqlx::query("DROP TRIGGER reject_new_generation")
        .execute(&db.pool)
        .await
        .unwrap();
    let (_, pending) = begin(&db, &session.id, &provider, &model, "Next question").await;
    db.checkpoint(&pending.id, "Checkpoint").await.unwrap();
    let checkpoint_metrics = metrics(&pending.id);
    db.save_metrics(&checkpoint_metrics).await.unwrap();
    sqlx::query("CREATE TRIGGER reject_final_metrics BEFORE INSERT ON generation_metrics BEGIN SELECT RAISE(ABORT, 'injected_failure'); END")
        .execute(&db.pool).await.unwrap();
    assert!(
        db.final_generation(
            &pending.id,
            "Final must roll back",
            "completed",
            Some("stop"),
            None,
            &checkpoint_metrics
        )
        .await
        .is_err()
    );
    let detail = db.session(&session.id).await.unwrap();
    assert_eq!(detail.messages.last().unwrap().content, "Checkpoint");
    assert_eq!(detail.messages.last().unwrap().status, "streaming");
    assert_eq!(
        detail
            .generations
            .iter()
            .find(|generation| generation.id == pending.id)
            .unwrap()
            .status,
        "streaming"
    );
    assert_eq!(detail.metrics.len(), 2);
    sqlx::query("DROP TRIGGER reject_final_metrics")
        .execute(&db.pool)
        .await
        .unwrap();
    let failure = AppError::new("provider", "Provider failed");
    db.final_generation(
        &pending.id,
        "Checkpoint",
        "failed",
        Some("error"),
        Some(&failure),
        &checkpoint_metrics,
    )
    .await
    .unwrap();
    let detail = db.session(&session.id).await.unwrap();
    assert_eq!(
        detail
            .generations
            .iter()
            .find(|generation| generation.id == pending.id)
            .unwrap()
            .error
            .as_ref()
            .unwrap()
            .0
            .code,
        "provider"
    );

    db.set_settings(&json!({"before": true})).await.unwrap();
    sqlx::query("CREATE TRIGGER reject_setting BEFORE INSERT ON settings WHEN NEW.key = 'fail' BEGIN SELECT RAISE(ABORT, 'injected_failure'); END")
        .execute(&db.pool).await.unwrap();
    assert!(
        db.set_settings(&json!({"another": 1, "fail": true}))
            .await
            .is_err()
    );
    assert_eq!(db.settings().await.unwrap(), json!({"before": true}));
    db.pool.close().await;
}

#[tokio::test]
async fn validation_rejects_secrets_invalid_actions_metrics_and_cross_session_edits() {
    let temp = TempDatabase::new();
    let db = Db::open(&temp.path).await.unwrap();
    let (provider, model) = configured(&db).await;
    let session = db.create_session("Validation").await.unwrap();
    let other = db.create_session("Other").await.unwrap();
    for value in [
        json!([]),
        json!({"api_key": "secret"}),
        json!({"nested": [{"Authorization": "Bearer secret"}]}),
        json!({"refreshToken": "secret"}),
    ] {
        assert_eq!(
            db.set_settings(&value).await.unwrap_err().code,
            "validation"
        );
        assert_eq!(
            db.update_session(&session.id, "Validation", None, &value)
                .await
                .unwrap_err()
                .code,
            "validation"
        );
    }
    let mut invalid_provider = provider.clone();
    invalid_provider.default_parameters = Json(json!({"apiKey": "secret"}));
    assert_eq!(
        db.save_provider(&invalid_provider).await.unwrap_err().code,
        "validation"
    );
    invalid_provider = provider.clone();
    invalid_provider.base_url = "https://user:secret@example.com/v1".into();
    assert_eq!(
        db.save_provider(&invalid_provider).await.unwrap_err().code,
        "validation"
    );
    invalid_provider.base_url = "https://example.com/v1?api_key=secret".into();
    assert_eq!(
        db.save_provider(&invalid_provider).await.unwrap_err().code,
        "validation"
    );
    invalid_provider = provider.clone();
    invalid_provider.authentication_mode = "unknown".into();
    assert_eq!(
        db.save_provider(&invalid_provider).await.unwrap_err().code,
        "validation"
    );
    let mut invalid_model = model.clone();
    invalid_model.default_parameters = Json(json!({"client_secret": "secret"}));
    assert_eq!(
        db.save_model(&invalid_model).await.unwrap_err().code,
        "validation"
    );
    for request in [
        input(&session.id, "unknown", Some("Question"), None),
        input(&session.id, "send", Some(" \n "), None),
        input(&session.id, "edit", Some("Question"), Some("missing")),
    ] {
        assert_eq!(
            db.begin_generation(&request, &provider, &model, &json!({}), &json!({}))
                .await
                .unwrap_err()
                .code,
            "validation"
        );
    }
    let request = input(&session.id, "send", Some("Question"), None);
    assert_eq!(
        db.begin_generation(
            &request,
            &provider,
            &model,
            &json!({"api_key": "secret"}),
            &json!({})
        )
        .await
        .unwrap_err()
        .code,
        "validation"
    );
    assert_eq!(
        db.begin_generation(
            &request,
            &provider,
            &model,
            &json!({}),
            &json!({"headers": {"authorization": "secret"}})
        )
        .await
        .unwrap_err()
        .code,
        "validation"
    );
    let (_, generation) = begin(&db, &session.id, &provider, &model, "Question").await;
    let mut invalid_metrics = metrics(&generation.id);
    invalid_metrics.ttft_ms = Some(f64::NAN);
    assert_eq!(
        db.save_metrics(&invalid_metrics).await.unwrap_err().code,
        "validation"
    );
    invalid_metrics.ttft_ms = Some(-1.0);
    assert_eq!(
        db.save_metrics(&invalid_metrics).await.unwrap_err().code,
        "validation"
    );
    assert_eq!(
        db.save_metrics(&metrics("missing")).await.unwrap_err().code,
        "referenced_data"
    );
    assert_eq!(
        db.final_generation(
            &generation.id,
            "Invalid",
            "streaming",
            None,
            None,
            &metrics(&generation.id)
        )
        .await
        .unwrap_err()
        .code,
        "validation"
    );
    assert_eq!(
        db.final_generation(
            &generation.id,
            "Invalid",
            "completed",
            None,
            None,
            &metrics("different")
        )
        .await
        .unwrap_err()
        .code,
        "validation"
    );
    complete(&db, &generation, "Answer").await;
    let user_id = db.session(&session.id).await.unwrap().messages[0]
        .id
        .clone();
    assert_eq!(
        db.begin_generation(
            &input(
                &other.id,
                "edit",
                Some("Cross-session edit"),
                Some(&user_id)
            ),
            &provider,
            &model,
            &json!({}),
            &json!({})
        )
        .await
        .unwrap_err()
        .code,
        "validation"
    );
    let other_provider = Provider {
        id: id(),
        name: "Other provider".into(),
        ..provider.clone()
    };
    db.save_provider(&other_provider).await.unwrap();
    assert_eq!(
        db.begin_generation(
            &input(&other.id, "send", Some("Question"), None),
            &other_provider,
            &model,
            &json!({}),
            &json!({})
        )
        .await
        .unwrap_err()
        .code,
        "validation"
    );
    assert!(db.session(&other.id).await.unwrap().messages.is_empty());
    db.pool.close().await;
}
