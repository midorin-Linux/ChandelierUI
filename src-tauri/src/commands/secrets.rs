//! API keys live only in the OS keyring (service = app identifier, account = provider id).
//! No command returns a key; the backend reads it itself when a request is made.

use keyring::{Entry, Error};

const SERVICE: &str = "me.suwako.chandelier-ui";

async fn run<T: Send + 'static>(
    job: impl FnOnce() -> Result<T, Error> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(job)
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| format!("Could not access the system keyring: {error}"))
}

pub(super) async fn load(provider_id: &str) -> Result<Option<String>, String> {
    let provider_id = provider_id.to_owned();
    run(
        move || match Entry::new(SERVICE, &provider_id)?.get_password() {
            Err(Error::NoEntry) => Ok(None),
            other => other.map(Some),
        },
    )
    .await
}

#[tauri::command]
pub async fn set_api_key(provider_id: String, key: String) -> Result<(), String> {
    run(move || Entry::new(SERVICE, &provider_id)?.set_password(&key)).await
}

#[tauri::command]
pub async fn delete_api_key(provider_id: String) -> Result<(), String> {
    run(
        move || match Entry::new(SERVICE, &provider_id)?.delete_credential() {
            Err(Error::NoEntry) => Ok(()),
            other => other,
        },
    )
    .await
}

#[tauri::command]
pub async fn has_api_key(provider_id: String) -> Result<bool, String> {
    Ok(load(&provider_id).await?.is_some())
}
