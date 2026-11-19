use sqlx::{FromRow, SqlitePool, types::Json};
use uuid::Uuid;

use super::{LoadedSession, SessionData, SessionSummary, StorageError, attempts, now_ms};
use crate::types::Role;

const TITLE_CHARS: usize = 40;

#[derive(FromRow)]
struct Row {
    #[sqlx(flatten)]
    summary: SessionSummary,
    data: Json<SessionData>,
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
    let title = data
        .messages
        .iter()
        .find(|message| message.role == Role::User)
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
        "INSERT INTO sessions (id, title, created_at, updated_at, data) VALUES (?1, ?2, ?3, ?4, ?5)",
    )
    .bind(&summary.id)
    .bind(&summary.title)
    .bind(summary.created_at)
    .bind(summary.updated_at)
    .bind(Json(data))
    .execute(pool)
    .await?;
    Ok(summary)
}

pub async fn load(pool: &SqlitePool, id: &str) -> Result<LoadedSession, StorageError> {
    let row: Row = sqlx::query_as(
        "SELECT id, title, created_at, updated_at, data FROM sessions WHERE id = ?1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| StorageError::NotFound(id.to_owned()))?;
    Ok(LoadedSession {
        summary: row.summary,
        data: row.data.0,
        attempts: attempts::list(pool, id).await?,
    })
}

pub async fn save(
    pool: &SqlitePool,
    id: &str,
    title: Option<&str>,
    data: &SessionData,
) -> Result<i64, StorageError> {
    let now = now_ms();
    let result = sqlx::query(
        "UPDATE sessions SET data = ?2, title = COALESCE(?3, title), updated_at = ?4 WHERE id = ?1",
    )
    .bind(id)
    .bind(Json(data))
    .bind(title)
    .bind(now)
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
