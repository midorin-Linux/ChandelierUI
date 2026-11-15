mod client;
mod metrics;
mod sse;
mod stream;
#[cfg(test)]
mod tests;
mod types;

pub use client::http_client;
use client::{complete, fetch_models};
use metrics::MeasuredCompletion;
use reqwest::Client;
use tauri::{State, ipc::Channel};
use types::{ChatPayload, CompletionDelta, Model, Provider};

#[tauri::command]
pub async fn chat_completion(
    client: State<'_, Client>,
    payload: ChatPayload,
    on_event: Channel<CompletionDelta>,
) -> Result<MeasuredCompletion, String> {
    Ok(complete(client.inner(), payload, |delta| {
        on_event
            .send(delta)
            .map_err(|_| "Could not deliver the chat response to the UI.".into())
    })
    .await)
}

#[tauri::command]
pub async fn list_models(
    client: State<'_, Client>,
    provider: Provider,
) -> Result<Vec<Model>, String> {
    fetch_models(client.inner(), provider).await
}
