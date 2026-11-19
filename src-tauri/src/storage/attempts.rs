use serde_json::Value;
use sqlx::{SqlitePool, types::Json};

use super::{StorageError, now_ms};

pub async fn append(
    pool: &SqlitePool,
    session_id: &str,
    attempt: &Value,
) -> Result<(), StorageError> {
    let seq = attempt["id"]
        .as_i64()
        .ok_or_else(|| StorageError::Invalid("attempt.id is missing".into()))?;
    let started_at = attempt["started_at"].as_str().unwrap_or_default();
    let mut tx = pool.begin().await?;
    sqlx::query("INSERT INTO attempts (session_id, seq, started_at, data) VALUES (?1, ?2, ?3, ?4)")
        .bind(session_id)
        .bind(seq)
        .bind(started_at)
        .bind(Json(attempt))
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE sessions SET updated_at = ?2 WHERE id = ?1")
        .bind(session_id)
        .bind(now_ms())
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

pub(super) async fn list(pool: &SqlitePool, session_id: &str) -> Result<Vec<Value>, StorageError> {
    let rows = sqlx::query_as::<_, (Json<Value>,)>(
        "SELECT data FROM attempts WHERE session_id = ?1 ORDER BY seq",
    )
    .bind(session_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(Json(attempt),)| attempt).collect())
}
