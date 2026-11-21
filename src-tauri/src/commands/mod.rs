mod client;
mod metrics;
pub mod secrets;
pub mod sessions;
pub mod settings;
mod sse;
mod stream;
#[cfg(test)]
mod tests;
mod types;

pub use client::{HttpClient, http_client};
use client::{complete_cancellable, fetch_models};
use metrics::MeasuredCompletion;
use tauri::{State, ipc::Channel};
use types::{ChatPayload, CompletionDelta, Model, Provider};

struct CancelGuard<'a>(&'a HttpClient, u64);

impl Drop for CancelGuard<'_> {
    fn drop(&mut self) {
        self.0.clear_cancel(self.1);
    }
}

async fn load_key(provider: &mut Provider) -> Result<(), String> {
    if let Some(id) = &provider.id {
        provider.api_key = secrets::load(id).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn chat_completion(
    client: State<'_, HttpClient>,
    mut payload: ChatPayload,
    on_event: Channel<CompletionDelta>,
) -> Result<MeasuredCompletion, String> {
    load_key(&mut payload.provider).await?;
    let (id, rx) = client.register_cancel();
    let _guard = CancelGuard(client.inner(), id);
    let cancel = async move {
        if rx.await.is_err() {
            std::future::pending::<()>().await;
        }
    };
    Ok(
        complete_cancellable(client.inner(), payload, cancel, |delta| {
            on_event
                .send(delta)
                .map_err(|_| "Could not deliver the chat response to the UI.".into())
        })
        .await,
    )
}

#[tauri::command]
pub fn cancel_chat(client: State<'_, HttpClient>) {
    client.cancel_active();
}

#[tauri::command]
pub async fn list_models(
    client: State<'_, HttpClient>,
    mut provider: Provider,
) -> Result<Vec<Model>, String> {
    load_key(&mut provider).await?;
    fetch_models(client.inner(), provider).await
}
