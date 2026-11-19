use std::collections::HashMap;

use serde_json::Value;
use tauri::State;

use crate::storage::{self, Db};

#[tauri::command]
pub async fn get_settings(db: State<'_, Db>) -> Result<HashMap<String, Value>, String> {
    storage::get_settings(&db.0)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_setting(db: State<'_, Db>, key: String, value: Value) -> Result<(), String> {
    storage::set_setting(&db.0, &key, &value)
        .await
        .map_err(|e| e.to_string())
}
