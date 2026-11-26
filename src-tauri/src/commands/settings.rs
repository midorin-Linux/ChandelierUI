use std::collections::HashMap;

use serde_json::Value;
use tauri::State;

use crate::{
    error::Error,
    storage::{self, Db},
};

#[tauri::command]
#[specta::specta]
pub async fn get_settings(db: State<'_, Db>) -> Result<HashMap<String, Value>, Error> {
    Ok(storage::get_settings(&db.0).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn set_setting(db: State<'_, Db>, key: String, value: Value) -> Result<(), Error> {
    Ok(storage::set_setting(&db.0, &key, &value).await?)
}
