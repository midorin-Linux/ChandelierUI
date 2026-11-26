//! API keys live only in the OS keyring (service = app identifier, account = provider id).
//! No command returns a key; the backend reads it itself when a request is made.

use keyring::Entry;

use crate::error::Error;

const SERVICE: &str = "me.suwako.chandelier-ui";

async fn run<T: Send + 'static>(
    job: impl FnOnce() -> Result<T, keyring::Error> + Send + 'static,
) -> Result<T, Error> {
    Ok(tokio::task::spawn_blocking(job)
        .await
        .map_err(Error::KeyringTask)??)
}

pub(super) async fn load(provider_id: &str) -> Result<Option<String>, Error> {
    let provider_id = provider_id.to_owned();
    run(
        move || match Entry::new(SERVICE, &provider_id)?.get_password() {
            Err(keyring::Error::NoEntry) => Ok(None),
            other => other.map(Some),
        },
    )
    .await
}

#[tauri::command]
pub async fn set_api_key(provider_id: String, key: String) -> Result<(), Error> {
    let key = valid_key(&key)?.to_owned();
    run(move || Entry::new(SERVICE, &provider_id)?.set_password(&key)).await
}

/// Keys are stored trimmed; a blank key is rejected rather than stored.
pub(super) fn valid_key(key: &str) -> Result<&str, Error> {
    match key.trim() {
        "" => Err(Error::InvalidInput("The API key is empty.")),
        key => Ok(key),
    }
}

#[tauri::command]
pub async fn delete_api_key(provider_id: String) -> Result<(), Error> {
    run(
        move || match Entry::new(SERVICE, &provider_id)?.delete_credential() {
            Err(keyring::Error::NoEntry) => Ok(()),
            other => other,
        },
    )
    .await
}

/// Checks for the credential with `get_credential`, which never returns the secret.
/// On macOS the Keychain lookup behind it may still show an access prompt.
#[tauri::command]
pub async fn has_api_key(provider_id: String) -> Result<bool, Error> {
    run(
        move || match Entry::new(SERVICE, &provider_id)?.inner.get_credential() {
            Ok(_) => Ok(true),
            Err(keyring::Error::NoEntry) => Ok(false),
            Err(error) => Err(error),
        },
    )
    .await
}
