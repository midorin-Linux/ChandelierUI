use sqlx::{FromRow, SqlitePool, types::Json};
use uuid::Uuid;

use super::{
    LoadedSession, SessionData, SessionSummary, StorageError, attempts, now_ms, types::NodeRole,
};

const TITLE_CHARS: usize = 40;
/// JSON shape version of `sessions.data`; the column default (1) is the old flat shape.
const SCHEMA_VERSION: i64 = 2;

#[derive(FromRow)]
struct Row {
    #[sqlx(flatten)]
    summary: SessionSummary,
    schema_version: i64,
    // Decoded after the version check, so an old shape is reported as such.
    data: String,
}

pub async fn list(pool: &SqlitePool) -> Result<Vec<SessionSummary>, StorageError> {
    Ok(sqlx::query_as(
        "SELECT id, title, created_at, updated_at FROM sessions ORDER BY updated_at DESC",
    )
    .fetch_all(pool)
    .await?)
}

/// The title is the first user message, truncated.
pub async fn create(pool: &SqlitePool, data: &SessionData) -> Result<SessionSummary, StorageError> {
    data.validate()?;
    let title = data
        .messages
        .iter()
        .find(|message| message.role == NodeRole::User)
        .map(|message| message.content.trim().chars().take(TITLE_CHARS).collect())
        .unwrap_or_default();
    let now = now_ms();
    let summary = SessionSummary {
        id: Uuid::now_v7().to_string(),
        title,
        created_at: now,
        updated_at: now,
    };
    sqlx::query(
        "INSERT INTO sessions (id, title, created_at, updated_at, schema_version, data) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )
    .bind(&summary.id)
    .bind(&summary.title)
    .bind(summary.created_at)
    .bind(summary.updated_at)
    .bind(SCHEMA_VERSION)
    .bind(Json(data))
    .execute(pool)
    .await?;
    Ok(summary)
}

pub async fn load(pool: &SqlitePool, id: &str) -> Result<LoadedSession, StorageError> {
    let row: Row = sqlx::query_as(
        "SELECT id, title, created_at, updated_at, schema_version, data FROM sessions WHERE id = ?1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| StorageError::NotFound(id.to_owned()))?;
    if row.schema_version != SCHEMA_VERSION {
        return Err(StorageError::Invalid(format!(
            "session {id} has schema_version {}; expected {SCHEMA_VERSION}. Reset the database to use it with this version",
            row.schema_version
        )));
    }
    let data: SessionData = serde_json::from_str(&row.data)
        .map_err(|error| StorageError::Invalid(format!("session {id} is unreadable: {error}")))?;
    data.validate()?;
    Ok(LoadedSession {
        summary: row.summary,
        data,
        attempts: attempts::list(pool, id).await?,
    })
}

pub async fn save(
    pool: &SqlitePool,
    id: &str,
    title: Option<&str>,
    data: &SessionData,
) -> Result<i64, StorageError> {
    data.validate()?;
    let now = now_ms();
    let result = sqlx::query(
        "UPDATE sessions SET data = ?2, title = COALESCE(?3, title), updated_at = ?4, schema_version = ?5 WHERE id = ?1",
    )
    .bind(id)
    .bind(Json(data))
    .bind(title)
    .bind(now)
    .bind(SCHEMA_VERSION)
    .execute(pool)
    .await?;
    if result.rows_affected() == 0 {
        return Err(StorageError::NotFound(id.to_owned()));
    }
    Ok(now)
}

pub async fn rename(pool: &SqlitePool, id: &str, title: &str) -> Result<(), StorageError> {
    let result = sqlx::query("UPDATE sessions SET title = ?2 WHERE id = ?1")
        .bind(id)
        .bind(title)
        .execute(pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(StorageError::NotFound(id.to_owned()));
    }
    Ok(())
}

/// Attempts go with it (`ON DELETE CASCADE`). Deleting an unknown id succeeds on
/// purpose, so repeating the call always ends in the same state.
pub async fn delete(pool: &SqlitePool, id: &str) -> Result<(), StorageError> {
    sqlx::query("DELETE FROM sessions WHERE id = ?1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}
