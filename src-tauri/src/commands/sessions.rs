use serde_json::Value;
use tauri::State;

use crate::storage::{self, Db, LoadedSession, SessionData, SessionSummary};

#[tauri::command]
pub async fn list_sessions(db: State<'_, Db>) -> Result<Vec<SessionSummary>, String> {
    storage::sessions::list(&db.0)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_session(
    db: State<'_, Db>,
    data: SessionData,
) -> Result<SessionSummary, String> {
    storage::sessions::create(&db.0, &data)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn load_session(db: State<'_, Db>, id: String) -> Result<LoadedSession, String> {
    storage::sessions::load(&db.0, &id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_session(
    db: State<'_, Db>,
    id: String,
    title: Option<String>,
    data: SessionData,
) -> Result<i64, String> {
    storage::sessions::save(&db.0, &id, title.as_deref(), &data)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rename_session(db: State<'_, Db>, id: String, title: String) -> Result<(), String> {
    storage::sessions::rename(&db.0, &id, &title)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_session(db: State<'_, Db>, id: String) -> Result<(), String> {
    storage::sessions::delete(&db.0, &id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn append_attempt(
    db: State<'_, Db>,
    session_id: String,
    attempt: Value,
) -> Result<(), String> {
    storage::attempts::append(&db.0, &session_id, &attempt)
        .await
        .map_err(|e| e.to_string())
}
