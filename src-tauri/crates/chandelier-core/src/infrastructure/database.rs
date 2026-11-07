use std::{path::Path, time::Duration};

use serde_json::Value;
use sqlx::{
    Sqlite, SqlitePool, Transaction,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
    types::Json,
};

use crate::domain::*;

#[derive(Clone)]
pub struct Db {
    pub pool: SqlitePool,
}

impl Db {
    pub async fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
        {
            std::fs::create_dir_all(parent)
                .map_err(|_| AppError::new("database", "データ保存先を作成できません。"))?;
        }
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .foreign_keys(true)
            .journal_mode(SqliteJournalMode::Wal)
            .busy_timeout(Duration::from_secs(10));
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await
            .map_err(db_error)?;
        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .map_err(|error| {
                tracing::error!(%error, "Database migration failed");
                AppError::new(
                    "migration",
                    "データベースの更新に失敗しました。既存のデータは削除しないでください。",
                )
            })?;
        let mut tx = pool.begin().await.map_err(db_error)?;
        let timestamp = now();
        let error = Json(AppError::new(
            "interrupted",
            "前回の終了により生成が中断されました。",
        ));
        sqlx::query("UPDATE generations SET status = 'failed', finished_at = ?, finish_reason = 'interrupted', error = ? WHERE status IN ('pending', 'streaming')")
            .bind(timestamp).bind(error).execute(&mut *tx).await.map_err(db_error)?;
        sqlx::query("UPDATE messages SET status = 'failed', updated_at = ? WHERE status IN ('pending', 'streaming')")
            .bind(timestamp).execute(&mut *tx).await.map_err(db_error)?;
        tx.commit().await.map_err(db_error)?;
        Ok(Self { pool })
    }

    pub async fn sessions(&self) -> Result<Vec<Session>> {
        sqlx::query_as("SELECT * FROM sessions ORDER BY updated_at DESC, id")
            .fetch_all(&self.pool)
            .await
            .map_err(db_error)
    }

    pub async fn create_session(&self, title: &str) -> Result<Session> {
        let title = valid_title(title)?;
        let timestamp = now();
        sqlx::query_as("INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?) RETURNING *")
            .bind(id()).bind(title).bind(timestamp).bind(timestamp)
            .fetch_one(&self.pool).await.map_err(db_error)
    }

    pub async fn session(&self, id: &str) -> Result<SessionDetail> {
        // One read transaction keeps the transcript and its generations on the same snapshot.
        let mut tx = self.pool.begin().await.map_err(db_error)?;
        let session = sqlx::query_as("SELECT * FROM sessions WHERE id = ?")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db_error)?
            .ok_or_else(not_found)?;
        let messages = sqlx::query_as(
            "SELECT * FROM messages WHERE session_id = ? AND active = 1 ORDER BY ordinal",
        )
        .bind(id)
        .fetch_all(&mut *tx)
        .await
        .map_err(db_error)?;
        let generations = sqlx::query_as(
            "SELECT * FROM generations WHERE session_id = ? ORDER BY started_at, id",
        )
        .bind(id)
        .fetch_all(&mut *tx)
        .await
        .map_err(db_error)?;
        let metrics: Vec<Json<GenerationMetrics>> = sqlx::query_scalar("SELECT gm.metrics FROM generation_metrics gm JOIN generations g ON g.id = gm.generation_id WHERE g.session_id = ? ORDER BY g.started_at, g.id")
            .bind(id).fetch_all(&mut *tx).await.map_err(db_error)?;
        tx.commit().await.map_err(db_error)?;
        Ok(SessionDetail {
            session,
            messages,
            generations,
            metrics: metrics.into_iter().map(|value| value.0).collect(),
        })
    }

    pub async fn generation_message(&self, generation_id: &str) -> Result<Message> {
        sqlx::query_as(
            "SELECT m.* FROM messages m JOIN generations g ON g.message_id = m.id WHERE g.id = ?",
        )
        .bind(generation_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(db_error)?
        .ok_or_else(not_found)
    }

    pub async fn update_session(
        &self,
        id: &str,
        title: &str,
        model_id: Option<&str>,
        settings: &Value,
    ) -> Result<Session> {
        let title = valid_title(title)?;
        valid_object(settings)?;
        sqlx::query_as("UPDATE sessions SET title = ?, selected_model_id = ?, session_settings = ?, updated_at = ? WHERE id = ? RETURNING *")
            .bind(title).bind(model_id).bind(Json(settings)).bind(now()).bind(id)
            .fetch_optional(&self.pool).await.map_err(db_error)?.ok_or_else(not_found)
    }

    pub async fn delete_session(&self, id: &str) -> Result<()> {
        affected(
            sqlx::query("DELETE FROM sessions WHERE id = ?")
                .bind(id)
                .execute(&self.pool)
                .await
                .map_err(db_error)?
                .rows_affected(),
        )
    }

    pub async fn providers(&self) -> Result<Vec<Provider>> {
        sqlx::query_as("SELECT * FROM providers ORDER BY created_at, id")
            .fetch_all(&self.pool)
            .await
            .map_err(db_error)
    }

    pub async fn save_provider(&self, provider: &Provider) -> Result<()> {
        if provider.id.trim().is_empty()
            || provider.name.trim().is_empty()
            || !matches!(provider.authentication_mode.as_str(), "none" | "bearer")
            || provider.timeout_seconds <= 0
            || !(provider.base_url.starts_with("http://")
                || provider.base_url.starts_with("https://"))
            || provider.base_url.contains(['@', '?', '#'])
            || provider
                .base_url
                .split_once("://")
                .is_none_or(|(_, host)| host.split('/').next().is_none_or(str::is_empty))
        {
            return Err(AppError::validation(
                "プロバイダーの名前、URL、認証方式、タイムアウトを確認してください。",
            ));
        }
        // Credentials belong in the OS credential store; only its reference is persisted here.
        valid_object(&provider.default_parameters.0)?;
        sqlx::query("INSERT INTO providers (id, name, base_url, authentication_mode, credential_reference, timeout_seconds, supports_usage, default_parameters, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, base_url = excluded.base_url, authentication_mode = excluded.authentication_mode, credential_reference = excluded.credential_reference, timeout_seconds = excluded.timeout_seconds, supports_usage = excluded.supports_usage, default_parameters = excluded.default_parameters")
            .bind(&provider.id).bind(&provider.name).bind(&provider.base_url).bind(&provider.authentication_mode)
            .bind(&provider.credential_reference).bind(provider.timeout_seconds).bind(provider.supports_usage)
            .bind(&provider.default_parameters).bind(provider.created_at)
            .execute(&self.pool).await.map_err(db_error)?;
        Ok(())
    }

    pub async fn delete_provider(&self, id: &str) -> Result<()> {
        let (tx, _) = self.begin_provider_deletion(id).await?;
        tx.commit().await.map_err(db_error)
    }

    pub(crate) async fn begin_provider_deletion(
        &self,
        id: &str,
    ) -> Result<(Transaction<'_, Sqlite>, Provider)> {
        let mut tx = self.pool.begin().await.map_err(db_error)?;
        let provider = sqlx::query_as("SELECT * FROM providers WHERE id = ?")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db_error)?
            .ok_or_else(not_found)?;
        // Run all foreign-key and active-generation guards before touching the OS store.
        sqlx::query("DELETE FROM models WHERE provider_id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        affected(
            sqlx::query("DELETE FROM providers WHERE id = ?")
                .bind(id)
                .execute(&mut *tx)
                .await
                .map_err(db_error)?
                .rows_affected(),
        )?;
        Ok((tx, provider))
    }

    pub async fn models(&self) -> Result<Vec<Model>> {
        sqlx::query_as("SELECT * FROM models ORDER BY display_name, id")
            .fetch_all(&self.pool)
            .await
            .map_err(db_error)
    }

    pub async fn save_model(&self, model: &Model) -> Result<()> {
        if model.id.trim().is_empty()
            || model.provider_id.trim().is_empty()
            || model.model_identifier.trim().is_empty()
            || model.display_name.trim().is_empty()
            || model
                .context_window
                .is_some_and(|value| value <= 0 || value as u64 > MAX_SAFE_INTEGER)
        {
            return Err(AppError::validation(
                "モデルの識別子、表示名、コンテキスト長を確認してください。",
            ));
        }
        valid_object(&model.capabilities.0)?;
        valid_object(&model.default_parameters.0)?;
        let count = sqlx::query("INSERT INTO models (id, provider_id, model_identifier, display_name, context_window, capabilities, default_parameters) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, context_window = excluded.context_window, capabilities = excluded.capabilities, default_parameters = excluded.default_parameters WHERE models.provider_id = excluded.provider_id AND models.model_identifier = excluded.model_identifier")
            .bind(&model.id).bind(&model.provider_id).bind(&model.model_identifier).bind(&model.display_name)
            .bind(model.context_window).bind(&model.capabilities).bind(&model.default_parameters)
            .execute(&self.pool).await.map_err(db_error)?.rows_affected();
        if count == 0 {
            return Err(AppError::validation(
                "既存モデルのプロバイダーと識別子は変更できません。",
            ));
        }
        Ok(())
    }

    pub async fn delete_model(&self, id: &str) -> Result<()> {
        affected(
            sqlx::query("DELETE FROM models WHERE id = ?")
                .bind(id)
                .execute(&self.pool)
                .await
                .map_err(db_error)?
                .rows_affected(),
        )
    }

    pub(crate) async fn cache_discovered_models(
        &self,
        provider_id: &str,
        identifiers: &[String],
    ) -> Result<Vec<Model>> {
        let mut tx = self.pool.begin().await.map_err(db_error)?;
        for identifier in identifiers {
            sqlx::query("INSERT INTO models (id, provider_id, model_identifier, display_name, context_window, capabilities, default_parameters) SELECT ?, ?, ?, ?, NULL, '{}', '{}' WHERE NOT EXISTS (SELECT 1 FROM models WHERE provider_id = ? AND model_identifier = ?)")
                .bind(id()).bind(provider_id).bind(identifier).bind(identifier).bind(provider_id).bind(identifier)
                .execute(&mut *tx).await.map_err(db_error)?;
        }
        let models =
            sqlx::query_as("SELECT * FROM models WHERE provider_id = ? ORDER BY display_name, id")
                .bind(provider_id)
                .fetch_all(&mut *tx)
                .await
                .map_err(db_error)?;
        tx.commit().await.map_err(db_error)?;
        Ok(models)
    }

    pub async fn settings(&self) -> Result<Value> {
        let rows: Vec<(String, Json<Value>)> =
            sqlx::query_as("SELECT key, value FROM settings ORDER BY key")
                .fetch_all(&self.pool)
                .await
                .map_err(db_error)?;
        Ok(Value::Object(
            rows.into_iter()
                .map(|(key, value)| (key, value.0))
                .collect(),
        ))
    }

    pub async fn set_settings(&self, settings: &Value) -> Result<()> {
        valid_object(settings)?;
        let mut tx = self.pool.begin().await.map_err(db_error)?;
        sqlx::query("DELETE FROM settings")
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        for (key, value) in settings.as_object().expect("validated object") {
            sqlx::query("INSERT INTO settings (key, value) VALUES (?, ?)")
                .bind(key)
                .bind(Json(value))
                .execute(&mut *tx)
                .await
                .map_err(db_error)?;
        }
        tx.commit().await.map_err(db_error)
    }

    pub(crate) async fn upsert_settings(&self, settings: &Value) -> Result<()> {
        valid_object(settings)?;
        let mut tx = self.pool.begin().await.map_err(db_error)?;
        for (key, value) in settings.as_object().expect("validated object") {
            sqlx::query("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
                .bind(key).bind(Json(value)).execute(&mut *tx).await.map_err(db_error)?;
        }
        tx.commit().await.map_err(db_error)
    }

    pub async fn begin_generation(
        &self,
        input: &GenerateInput,
        provider: &Provider,
        model: &Model,
        parameters: &Value,
        snapshot: &Value,
    ) -> Result<(Message, Generation)> {
        valid_object(parameters)?;
        valid_object(snapshot)?;
        if model.provider_id != provider.id {
            return Err(AppError::validation("モデルとプロバイダーが一致しません。"));
        }
        if !matches!(input.action.as_str(), "send" | "regenerate" | "edit") {
            return Err(AppError::validation("生成操作が不正です。"));
        }
        if input.action != "regenerate"
            && input
                .content
                .as_deref()
                .is_none_or(|text| text.trim().is_empty())
        {
            return Err(AppError::validation("メッセージを入力してください。"));
        }
        let mut tx = self.pool.begin().await.map_err(db_error)?;
        // Acquire the SQLite writer lock before reading history; concurrent starts cannot branch from stale rows.
        affected(
            sqlx::query("UPDATE sessions SET updated_at = updated_at WHERE id = ?")
                .bind(&input.session_id)
                .execute(&mut *tx)
                .await
                .map_err(db_error)?
                .rows_affected(),
        )?;
        let related: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM models m JOIN providers p ON p.id = m.provider_id WHERE m.id = ? AND p.id = ?)")
            .bind(&model.id).bind(&provider.id).fetch_one(&mut *tx).await.map_err(db_error)?;
        if !related {
            return Err(AppError::validation(
                "モデルまたはプロバイダーが存在しません。",
            ));
        }
        let messages: Vec<Message> = sqlx::query_as(
            "SELECT * FROM messages WHERE session_id = ? AND active = 1 ORDER BY ordinal",
        )
        .bind(&input.session_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(db_error)?;
        let timestamp = now();
        let assistant_ordinal = match input.action.as_str() {
            "send" => {
                let ordinal = messages.last().map_or(0, |message| message.ordinal + 1);
                insert_user(
                    &mut tx,
                    &input.session_id,
                    input.content.as_deref().expect("validated content"),
                    ordinal,
                    timestamp,
                )
                .await?;
                ordinal + 1
            }
            "regenerate" => {
                let assistant = messages
                    .last()
                    .filter(|message| message.role == "assistant")
                    .ok_or_else(|| AppError::validation("再生成する応答がありません。"))?;
                if !messages
                    .iter()
                    .any(|message| message.role == "user" && message.ordinal < assistant.ordinal)
                {
                    return Err(AppError::validation(
                        "再生成するユーザーメッセージがありません。",
                    ));
                }
                sqlx::query("UPDATE messages SET active = 0 WHERE id = ?")
                    .bind(&assistant.id)
                    .execute(&mut *tx)
                    .await
                    .map_err(db_error)?;
                assistant.ordinal
            }
            "edit" => {
                let target = messages
                    .iter()
                    .find(|message| {
                        Some(message.id.as_str()) == input.message_id.as_deref()
                            && message.role == "user"
                    })
                    .ok_or_else(|| {
                        AppError::validation("編集するユーザーメッセージがありません。")
                    })?;
                sqlx::query("UPDATE messages SET active = 0 WHERE session_id = ? AND active = 1 AND ordinal >= ?")
                    .bind(&input.session_id).bind(target.ordinal).execute(&mut *tx).await.map_err(db_error)?;
                insert_user(
                    &mut tx,
                    &input.session_id,
                    input.content.as_deref().expect("validated content"),
                    target.ordinal,
                    timestamp,
                )
                .await?;
                target.ordinal + 1
            }
            _ => unreachable!("validated action"),
        };
        let message: Message = sqlx::query_as("INSERT INTO messages (id, session_id, role, content, status, created_at, updated_at, ordinal) VALUES (?, ?, 'assistant', '', 'pending', ?, ?, ?) RETURNING *")
            .bind(id()).bind(&input.session_id).bind(timestamp).bind(timestamp).bind(assistant_ordinal)
            .fetch_one(&mut *tx).await.map_err(db_error)?;
        sqlx::query("UPDATE sessions SET updated_at = ? WHERE id = ?")
            .bind(timestamp)
            .bind(&input.session_id)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        let generation = sqlx::query_as("INSERT INTO generations (id, session_id, message_id, provider_id, model_id, status, request_parameters, request_snapshot, started_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?) RETURNING *")
            .bind(id()).bind(&input.session_id).bind(&message.id).bind(&provider.id).bind(&model.id)
            .bind(Json(parameters)).bind(Json(snapshot)).bind(timestamp)
            .fetch_one(&mut *tx).await.map_err(db_error)?;
        tx.commit().await.map_err(db_error)?;
        Ok((message, generation))
    }

    pub async fn checkpoint(&self, generation_id: &str, content: &str) -> Result<()> {
        let mut tx = self.pool.begin().await.map_err(db_error)?;
        let message_id: Option<String> = sqlx::query_scalar("UPDATE generations SET status = 'streaming' WHERE id = ? AND status IN ('pending', 'streaming') RETURNING message_id")
            .bind(generation_id).fetch_optional(&mut *tx).await.map_err(db_error)?;
        let message_id = message_id.ok_or_else(inactive_generation)?;
        sqlx::query(
            "UPDATE messages SET content = ?, status = 'streaming', updated_at = ? WHERE id = ?",
        )
        .bind(content)
        .bind(now())
        .bind(message_id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        tx.commit().await.map_err(db_error)
    }

    pub async fn final_generation(
        &self,
        id: &str,
        content: &str,
        status: &str,
        finish_reason: Option<&str>,
        error: Option<&AppError>,
        metrics: &GenerationMetrics,
    ) -> Result<()> {
        if !matches!(status, "completed" | "cancelled" | "failed") {
            return Err(AppError::validation("生成の終了状態が不正です。"));
        }
        if metrics.generation_id != id {
            return Err(AppError::validation("メトリクスの生成IDが一致しません。"));
        }
        valid_metrics(metrics)?;
        let mut tx = self.pool.begin().await.map_err(db_error)?;
        let timestamp = now();
        let row: Option<(String, String)> = sqlx::query_as("UPDATE generations SET status = ?, finished_at = ?, finish_reason = ?, error = ? WHERE id = ? AND status IN ('pending', 'streaming') RETURNING message_id, session_id")
            .bind(status).bind(timestamp).bind(finish_reason).bind(error.map(Json)).bind(id)
            .fetch_optional(&mut *tx).await.map_err(db_error)?;
        let (message_id, session_id) = row.ok_or_else(inactive_generation)?;
        sqlx::query("UPDATE messages SET content = ?, status = ?, updated_at = ? WHERE id = ?")
            .bind(content)
            .bind(status)
            .bind(timestamp)
            .bind(message_id)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        write_metrics(&mut tx, metrics).await?;
        sqlx::query("UPDATE sessions SET updated_at = ? WHERE id = ?")
            .bind(timestamp)
            .bind(session_id)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        tx.commit().await.map_err(db_error)
    }

    pub async fn save_metrics(&self, metrics: &GenerationMetrics) -> Result<()> {
        valid_metrics(metrics)?;
        let mut tx = self.pool.begin().await.map_err(db_error)?;
        write_metrics(&mut tx, metrics).await?;
        tx.commit().await.map_err(db_error)
    }
}

async fn insert_user(
    tx: &mut Transaction<'_, Sqlite>,
    session_id: &str,
    content: &str,
    ordinal: i64,
    timestamp: i64,
) -> Result<()> {
    sqlx::query("INSERT INTO messages (id, session_id, role, content, status, created_at, updated_at, ordinal) VALUES (?, ?, 'user', ?, 'completed', ?, ?, ?)")
        .bind(id()).bind(session_id).bind(content).bind(timestamp).bind(timestamp).bind(ordinal)
        .execute(&mut **tx).await.map_err(db_error)?;
    Ok(())
}

async fn write_metrics(
    tx: &mut Transaction<'_, Sqlite>,
    metrics: &GenerationMetrics,
) -> Result<()> {
    sqlx::query("INSERT INTO generation_metrics (generation_id, metrics) VALUES (?, ?) ON CONFLICT(generation_id) DO UPDATE SET metrics = excluded.metrics")
        .bind(&metrics.generation_id).bind(Json(metrics)).execute(&mut **tx).await.map_err(db_error)?;
    Ok(())
}

fn valid_title(title: &str) -> Result<&str> {
    let title = title.trim();
    if title.is_empty() || title.chars().count() > 200 {
        Err(AppError::validation(
            "タイトルは1〜200文字で入力してください。",
        ))
    } else {
        Ok(title)
    }
}

fn valid_object(value: &Value) -> Result<()> {
    if !value.is_object() {
        return Err(AppError::validation(
            "設定はJSONオブジェクトで指定してください。",
        ));
    }
    fn contains_secret(value: &Value) -> bool {
        match value {
            Value::Object(object) => object.iter().any(|(key, value)| {
                let normalized: String = key
                    .chars()
                    .filter(|c| *c != '_' && *c != '-')
                    .flat_map(char::to_lowercase)
                    .collect();
                matches!(
                    normalized.as_str(),
                    "apikey"
                        | "authorization"
                        | "password"
                        | "clientsecret"
                        | "accesstoken"
                        | "refreshtoken"
                ) || contains_secret(value)
            }),
            Value::Array(values) => values.iter().any(contains_secret),
            _ => false,
        }
    }
    if contains_secret(value) {
        return Err(AppError::validation(
            "認証情報は設定やリクエストに保存できません。OSの認証情報ストアを使用してください。",
        ));
    }
    Ok(())
}

fn valid_metrics(metrics: &GenerationMetrics) -> Result<()> {
    let values = [
        metrics.request_latency_ms,
        metrics.first_event_ms,
        metrics.ttft_ms,
        metrics.generation_duration_ms,
        metrics.total_duration_ms,
        metrics.output_tps,
        metrics.generation_throughput,
        metrics.context_usage_percent,
    ];
    if metrics.generation_id.is_empty()
        || values
            .into_iter()
            .flatten()
            .any(|value| !value.is_finite() || value < 0.0)
    {
        return Err(AppError::validation("メトリクスの値が不正です。"));
    }
    Ok(())
}

fn affected(count: u64) -> Result<()> {
    if count == 0 { Err(not_found()) } else { Ok(()) }
}
fn not_found() -> AppError {
    AppError::new("not_found", "指定されたデータが見つかりません。")
}
fn inactive_generation() -> AppError {
    AppError::new(
        "generation_not_active",
        "指定された生成は存在しないか、すでに終了しています。",
    )
}
fn db_error(error: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(database) = &error {
        let message = database.message();
        if message.contains("active_generation") || message.contains("generations.session_id") {
            return AppError::new(
                "generation_active",
                "生成中は変更・削除できません。先に生成を停止してください。",
            );
        }
        if database.is_foreign_key_violation() || message.contains("FOREIGN KEY constraint failed")
        {
            return AppError::new(
                "referenced_data",
                "参照先が存在しないか、履歴から参照されているため変更・削除できません。",
            );
        }
        if database.is_unique_violation() {
            return AppError::new(
                "conflict",
                "同じ識別子または順序のデータがすでに存在します。",
            );
        }
        if database.is_check_violation()
            || message.contains("model_provider_mismatch")
            || message.contains("immutable_model")
        {
            return AppError::validation("保存するデータの形式が不正です。");
        }
    }
    error.into()
}
