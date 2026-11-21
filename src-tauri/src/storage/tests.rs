use std::{collections::BTreeMap, time::Duration};

use serde_json::json;
use sqlx::{SqlitePool, sqlite::SqlitePoolOptions};

use super::{
    SessionData, StorageError, attempts, get_settings, sessions, set_setting,
    types::{MessageNode, NodeRole},
};
use crate::types::ReasoningEffort;

/// `sqlite::memory:` is a separate database per connection, so pin one connection
/// and never let the pool reap it.
pub(crate) async fn memory_pool() -> SqlitePool {
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

fn data(text: &str) -> SessionData {
    SessionData {
        model: "m".into(),
        reasoning_effort: ReasoningEffort::Medium,
        system_prompt: String::new(),
        messages: vec![node("u1", None, NodeRole::User, text)],
        branches: BTreeMap::from([("main".into(), Some("u1".into()))]),
        current_branch: "main".into(),
    }
}

fn node(id: &str, parent: Option<&str>, role: NodeRole, text: &str) -> MessageNode {
    MessageNode {
        id: id.into(),
        parent_id: parent.map(Into::into),
        role,
        content: text.into(),
        reasoning: String::new(),
        created_at: 1,
    }
}

fn attempt(seq: i64) -> serde_json::Value {
    json!({ "id": seq, "version": 1, "started_at": "2026-11-19T00:00:00Z", "retry": false })
}

#[tokio::test]
async fn session_roundtrip_with_title_from_first_message() {
    let pool = memory_pool().await;
    let long = "あ".repeat(100);
    let summary = sessions::create(&pool, &data(&long)).await.unwrap();
    assert_eq!(summary.title.chars().count(), 40);
    assert_eq!(summary.created_at, summary.updated_at);
    let loaded = sessions::load(&pool, &summary.id).await.unwrap();
    assert_eq!(loaded.data, data(&long));
    assert_eq!(loaded.summary, summary);
    assert!(loaded.attempts.is_empty());
}

#[tokio::test]
async fn save_updates_data_and_keeps_title_unless_given() {
    let pool = memory_pool().await;
    let id = sessions::create(&pool, &data("hi")).await.unwrap().id;
    sessions::save(&pool, &id, None, &data("bye"))
        .await
        .unwrap();
    let loaded = sessions::load(&pool, &id).await.unwrap();
    assert_eq!(loaded.summary.title, "hi");
    assert_eq!(loaded.data, data("bye"));
    sessions::save(&pool, &id, Some("named"), &data("bye"))
        .await
        .unwrap();
    assert_eq!(
        sessions::load(&pool, &id).await.unwrap().summary.title,
        "named"
    );
}

#[tokio::test]
async fn missing_session_is_not_found() {
    let pool = memory_pool().await;
    assert!(matches!(
        sessions::save(&pool, "nope", None, &data("x")).await,
        Err(StorageError::NotFound(_))
    ));
    assert!(matches!(
        sessions::rename(&pool, "nope", "t").await,
        Err(StorageError::NotFound(_))
    ));
    assert!(matches!(
        sessions::load(&pool, "nope").await,
        Err(StorageError::NotFound(_))
    ));
}

#[tokio::test]
async fn attempts_are_ordered_unique_and_cascade_on_delete() {
    let pool = memory_pool().await;
    let id = sessions::create(&pool, &data("hi")).await.unwrap().id;
    for seq in [2, 1] {
        attempts::append(&pool, &id, &attempt(seq)).await.unwrap();
    }
    assert!(matches!(
        attempts::append(&pool, &id, &attempt(1)).await,
        Err(StorageError::Sqlx(_))
    ));
    assert!(matches!(
        attempts::append(&pool, &id, &json!({ "version": 1 })).await,
        Err(StorageError::Invalid(_))
    ));
    let loaded = sessions::load(&pool, &id).await.unwrap();
    assert_eq!(loaded.attempts, vec![attempt(1), attempt(2)]);
    sessions::delete(&pool, &id).await.unwrap();
    let left: i64 = sqlx::query_scalar("SELECT count(*) FROM attempts")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(left, 0);
}

#[tokio::test]
async fn list_is_newest_updated_first() {
    let pool = memory_pool().await;
    let a = sessions::create(&pool, &data("a")).await.unwrap().id;
    let b = sessions::create(&pool, &data("b")).await.unwrap().id;
    tokio::time::sleep(Duration::from_millis(2)).await;
    attempts::append(&pool, &a, &attempt(1)).await.unwrap();
    let ids: Vec<_> = sessions::list(&pool)
        .await
        .unwrap()
        .into_iter()
        .map(|session| session.id)
        .collect();
    assert_eq!(ids, vec![a, b]);
}

#[tokio::test]
async fn tree_roundtrips_with_null_heads_and_reasoning() {
    let pool = memory_pool().await;
    let mut tree = data("hi");
    tree.messages
        .push(node("a1", Some("u1"), NodeRole::Assistant, "yo"));
    tree.messages[1].reasoning = "thinking".into();
    tree.branches.insert("main".into(), Some("a1".into()));
    tree.branches.insert("empty".into(), None);
    let id = sessions::create(&pool, &tree).await.unwrap().id;
    assert_eq!(sessions::load(&pool, &id).await.unwrap().data, tree);
    let empty = SessionData {
        messages: vec![],
        branches: BTreeMap::from([("main".into(), None)]),
        ..data("")
    };
    sessions::save(&pool, &id, None, &empty).await.unwrap();
    assert_eq!(sessions::load(&pool, &id).await.unwrap().data, empty);
    let version: i64 = sqlx::query_scalar("SELECT schema_version FROM sessions WHERE id = ?1")
        .bind(&id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(version, 2);
}

#[tokio::test]
async fn schema_version_1_row_is_rejected_on_load() {
    let pool = memory_pool().await;
    sqlx::query(
        "INSERT INTO sessions (id, created_at, updated_at, data) VALUES ('old', 1, 1, ?1)",
    )
    .bind(r#"{"model":"m","reasoning_effort":"medium","system_prompt":"","messages":[{"role":"user","content":"hi"}]}"#)
    .execute(&pool)
    .await
    .unwrap();
    let error = sessions::load(&pool, "old").await.unwrap_err();
    assert!(matches!(&error, StorageError::Invalid(reason) if reason.contains("schema_version 1")));
}

#[tokio::test]
async fn invalid_trees_are_rejected_on_create_and_save() {
    let pool = memory_pool().await;
    let id = sessions::create(&pool, &data("hi")).await.unwrap().id;
    let mut missing_parent = data("hi");
    missing_parent.messages[0].parent_id = Some("nope".into());
    let mut forward_parent = data("hi");
    forward_parent
        .messages
        .insert(0, node("a1", Some("u1"), NodeRole::Assistant, "x"));
    let mut duplicate = data("hi");
    duplicate
        .messages
        .push(node("u1", None, NodeRole::User, "again"));
    let mut missing_head = data("hi");
    missing_head
        .branches
        .insert("main".into(), Some("nope".into()));
    let mut missing_branch = data("hi");
    missing_branch.current_branch = "other".into();
    for bad in [
        missing_parent,
        forward_parent,
        duplicate,
        missing_head,
        missing_branch,
    ] {
        assert!(matches!(
            sessions::create(&pool, &bad).await,
            Err(StorageError::Invalid(_))
        ));
        assert!(matches!(
            sessions::save(&pool, &id, None, &bad).await,
            Err(StorageError::Invalid(_))
        ));
    }
    assert_eq!(sessions::load(&pool, &id).await.unwrap().data, data("hi"));
}

#[tokio::test]
async fn attempt_versions_other_than_1_are_rejected() {
    let pool = memory_pool().await;
    let id = sessions::create(&pool, &data("hi")).await.unwrap().id;
    for bad in [json!({ "id": 1 }), json!({ "id": 1, "version": 2 })] {
        assert!(matches!(
            attempts::append(&pool, &id, &bad).await,
            Err(StorageError::Invalid(_))
        ));
    }
    attempts::append(&pool, &id, &attempt(1)).await.unwrap();
    let loaded = sessions::load(&pool, &id).await.unwrap();
    assert_eq!(loaded.attempts, vec![attempt(1)]);
}
