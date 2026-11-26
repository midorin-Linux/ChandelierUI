mod client;
mod metrics;
mod providers;
pub mod secrets;
pub mod sessions;
pub mod settings;
mod sse;
mod stream;
#[cfg(test)]
mod tests;
mod types;

use std::time::Duration;

pub use client::{HttpClient, http_client};
use client::{complete_cancellable, fetch_models};
use metrics::MeasuredCompletion;
use sqlx::SqlitePool;
use tauri::{State, ipc::Channel};
use types::{ChatPayload, CompletionDelta, Model, Provider};

use crate::{error::Error, storage::Db};

struct CancelGuard<'a>(&'a HttpClient, u64);

impl Drop for CancelGuard<'_> {
    fn drop(&mut self) {
        self.0.clear_cancel(self.1);
    }
}

#[tauri::command]
pub async fn chat_completion(
    client: State<'_, HttpClient>,
    db: State<'_, Db>,
    mut payload: ChatPayload,
    on_event: Channel<CompletionDelta>,
) -> Result<MeasuredCompletion, Error> {
    providers::resolve(&db.0, &mut payload.provider, secrets::load).await?;
    payload.timeout = response_timeout(&db.0).await?;
    let (id, rx) = client.register_cancel();
    let _guard = CancelGuard(client.inner(), id);
    let cancel = async move {
        if rx.await.is_err() {
            std::future::pending::<()>().await;
        }
    };
    Ok(
        complete_cancellable(client.inner(), payload, cancel, |delta| {
            on_event.send(delta).map_err(|_| Error::Channel)
        })
        .await,
    )
}

/// The saved response timeout; `None` when unset or outside 1..=3600 seconds.
async fn response_timeout(pool: &SqlitePool) -> Result<Option<Duration>, Error> {
    let settings = crate::storage::get_settings(pool).await?;
    Ok(settings
        .get("chat.timeout_secs")
        .and_then(serde_json::Value::as_u64)
        .filter(|secs| (1 ..= 3600).contains(secs))
        .map(Duration::from_secs))
}

#[tauri::command]
pub fn cancel_chat(client: State<'_, HttpClient>) {
    client.cancel_active();
}

#[tauri::command]
pub async fn list_models(
    client: State<'_, HttpClient>,
    db: State<'_, Db>,
    provider: Provider,
) -> Result<Vec<Model>, Error> {
    list_models_with(client.inner(), &db.0, provider, secrets::load).await
}

async fn list_models_with(
    client: &HttpClient,
    pool: &SqlitePool,
    mut provider: Provider,
    load_key: impl AsyncFnOnce(&str) -> Result<Option<String>, Error>,
) -> Result<Vec<Model>, Error> {
    providers::resolve(pool, &mut provider, load_key).await?;
    fetch_models(client, provider).await
}
