//! Resolves an IPC `Provider` against the saved presets, so the webview can never
//! pair a stored API key with a URL of its own choosing.

use serde::Deserialize;
use sqlx::SqlitePool;

use super::types::Provider;
use crate::storage;

const PRESETS: &str = "provider.presets";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Preset {
    id: String,
    base_url: String,
}

/// With an id: the base URL comes from the saved preset (the IPC one is ignored)
/// and the key from `load_key`. An unknown id is an error and reads no key.
/// Without an id: the IPC base URL is used as is, with no key.
pub(super) async fn resolve(
    pool: &SqlitePool,
    provider: &mut Provider,
    load_key: impl AsyncFnOnce(&str) -> Result<Option<String>, String>,
) -> Result<(), String> {
    provider.api_key = None;
    let Some(id) = provider.id.clone() else {
        return Ok(());
    };
    let settings = storage::get_settings(pool)
        .await
        .map_err(|error| error.to_string())?;
    let presets: Vec<Preset> = match settings.get(PRESETS) {
        Some(value) => serde_json::from_value(value.clone())
            .map_err(|error| format!("Saved provider presets are invalid: {error}"))?,
        None => Vec::new(),
    };
    let preset = presets
        .into_iter()
        .find(|preset| preset.id == id)
        .ok_or_else(|| format!("Unknown provider preset: {id}"))?;
    provider.base_url = Some(preset.base_url);
    provider.api_key = load_key(&id).await?;
    Ok(())
}
