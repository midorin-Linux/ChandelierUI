use std::time::Duration;

use serde_json::json;
use sqlx::{SqlitePool, sqlite::SqlitePoolOptions};

use super::{StorageError, get_settings, set_setting};

/// `sqlite::memory:` is a separate database per connection, so pin one connection
/// and never let the pool reap it.
async fn memory_pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .idle_timeout(None::<Duration>)
        .max_lifetime(None::<Duration>)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::query("PRAGMA foreign_keys = ON")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    pool
}

#[tokio::test]
async fn settings_upsert_and_read_back() {
    let pool = memory_pool().await;
    assert!(get_settings(&pool).await.unwrap().is_empty());
    set_setting(&pool, "provider.base_url", &json!("http://a/v1"))
        .await
        .unwrap();
    set_setting(&pool, "provider.base_url", &json!("http://b/v1"))
        .await
        .unwrap();
    let all = get_settings(&pool).await.unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all["provider.base_url"], json!("http://b/v1"));
}

#[tokio::test]
async fn settings_reject_empty_key() {
    let pool = memory_pool().await;
    let error = set_setting(&pool, "", &json!(1)).await.unwrap_err();
    assert!(matches!(error, StorageError::Invalid(_)));
}
