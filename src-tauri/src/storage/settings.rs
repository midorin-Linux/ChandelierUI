use std::collections::HashMap;

use serde_json::Value;
use sqlx::{SqlitePool, types::Json};

use super::{StorageError, now_ms};

pub async fn get_all(pool: &SqlitePool) -> Result<HashMap<String, Value>, StorageError> {
    let rows = sqlx::query_as::<_, (String, Json<Value>)>("SELECT key, value FROM settings")
        .fetch_all(pool)
        .await?;
    Ok(rows
        .into_iter()
        .map(|(key, Json(value))| (key, value))
        .collect())
}

pub async fn set(pool: &SqlitePool, key: &str, value: &Value) -> Result<(), StorageError> {
    if key.is_empty() {
        return Err(StorageError::Invalid("setting key is empty".into()));
    }
    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(key)
    .bind(Json(value))
    .bind(now_ms())
    .execute(pool)
    .await?;
    Ok(())
}
