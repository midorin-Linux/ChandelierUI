use serde_json::Value;
use tauri::State;

use crate::{
    error::Error,
    storage::{self, Db, LoadedSession, SessionData, SessionSummary},
};

#[tauri::command]
#[specta::specta]
pub async fn list_sessions(db: State<'_, Db>) -> Result<Vec<SessionSummary>, Error> {
    Ok(storage::sessions::list(&db.0).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn create_session(db: State<'_, Db>, data: SessionData) -> Result<SessionSummary, Error> {
    Ok(storage::sessions::create(&db.0, &data).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn load_session(db: State<'_, Db>, id: String) -> Result<LoadedSession, Error> {
    Ok(storage::sessions::load(&db.0, &id).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn save_session(
    db: State<'_, Db>,
    id: String,
    title: Option<String>,
    data: SessionData,
) -> Result<i64, Error> {
    Ok(storage::sessions::save(&db.0, &id, title.as_deref(), &data).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn rename_session(db: State<'_, Db>, id: String, title: String) -> Result<(), Error> {
    Ok(storage::sessions::rename(&db.0, &id, &title).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn delete_session(db: State<'_, Db>, id: String) -> Result<(), Error> {
    Ok(storage::sessions::delete(&db.0, &id).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn append_attempt(
    db: State<'_, Db>,
    session_id: String,
    attempt: Value,
) -> Result<(), Error> {
    Ok(storage::attempts::append(&db.0, &session_id, &attempt).await?)
}
