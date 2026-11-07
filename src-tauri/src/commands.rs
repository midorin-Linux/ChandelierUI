use chandelier_core::{
    domain::*,
    infrastructure::{credentials, database::Db},
    services::{ChatService, configuration, parameters},
};
use serde_json::Value;
use tauri::State;

pub struct AppState {
    pub db: Db,
    pub chat: ChatService,
    pub data_directory: String,
    pub log_filter: tracing_subscriber::reload::Handle<
        tracing_subscriber::EnvFilter,
        tracing_subscriber::Registry,
    >,
}

#[tauri::command]
pub async fn bootstrap(state: State<'_, AppState>) -> Result<Bootstrap> {
    Ok(Bootstrap {
        sessions: state.db.sessions().await?,
        providers: state.db.providers().await?,
        models: state.db.models().await?,
        settings: configuration::bootstrap_settings(&state.db).await?,
        data_directory: state.data_directory.clone(),
    })
}

#[tauri::command]
pub async fn create_session(state: State<'_, AppState>, title: String) -> Result<Session> {
    let session = state.db.create_session(&title).await?;
    let settings = configuration::bootstrap_settings(&state.db).await?;
    if let Some(model_id) = settings.get("last_model_id").and_then(Value::as_str)
        && state
            .db
            .models()
            .await?
            .iter()
            .any(|model| model.id == model_id)
    {
        return state
            .db
            .update_session(
                &session.id,
                &session.title,
                Some(model_id),
                &session.session_settings,
            )
            .await;
    }
    Ok(session)
}

#[tauri::command]
pub async fn session_detail(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<SessionDetail> {
    state.db.session(&session_id).await
}

#[tauri::command]
pub async fn generation_message(
    state: State<'_, AppState>,
    generation_id: String,
) -> Result<Message> {
    state.db.generation_message(&generation_id).await
}

#[tauri::command]
pub async fn update_session(
    state: State<'_, AppState>,
    session_id: String,
    title: String,
    model_id: Option<String>,
    settings: Value,
) -> Result<Session> {
    parameters::validate(&settings)?;
    let session = state
        .db
        .update_session(&session_id, &title, model_id.as_deref(), &settings)
        .await?;
    configuration::remember_model(&state.db, model_id.as_deref()).await?;
    Ok(session)
}

#[tauri::command]
pub async fn delete_session(state: State<'_, AppState>, session_id: String) -> Result<()> {
    state.db.delete_session(&session_id).await
}

#[tauri::command]
pub async fn generate(
    state: State<'_, AppState>,
    input: GenerateInput,
    on_event: tauri::ipc::Channel<StreamEvent>,
) -> Result<()> {
    state
        .chat
        .generate(input, credentials::read_provider, |event| {
            on_event
                .send(event)
                .map_err(|_| AppError::new("ipc", "画面との接続が失われました。"))
        })
        .await
}

#[tauri::command]
pub async fn cancel_generation(state: State<'_, AppState>, session_id: String) -> Result<()> {
    state.chat.cancel(&session_id).await
}

#[tauri::command]
pub async fn save_provider(
    state: State<'_, AppState>,
    provider: Provider,
    api_key: Option<String>,
) -> Result<Provider> {
    configuration::save_provider(&state.db, provider, api_key).await
}

#[tauri::command]
pub async fn delete_provider(state: State<'_, AppState>, provider_id: String) -> Result<()> {
    configuration::delete_provider(&state.db, &provider_id).await
}

#[tauri::command]
pub async fn test_provider(state: State<'_, AppState>, provider_id: String) -> Result<()> {
    configuration::test_provider(&state.db, &provider_id).await
}

#[tauri::command]
pub async fn refresh_models(state: State<'_, AppState>, provider_id: String) -> Result<Vec<Model>> {
    configuration::refresh_models(&state.db, &provider_id).await
}

#[tauri::command]
pub async fn save_model(state: State<'_, AppState>, model: Model) -> Result<Model> {
    configuration::save_model(&state.db, model).await
}

#[tauri::command]
pub async fn delete_model(state: State<'_, AppState>, model_id: String) -> Result<()> {
    state.db.delete_model(&model_id).await
}

#[tauri::command]
pub async fn save_settings(state: State<'_, AppState>, settings: Value) -> Result<Value> {
    let settings = configuration::save_settings(&state.db, &settings).await?;
    state
        .log_filter
        .reload(crate::log_filter(
            settings["log_level"].as_str().unwrap_or("info"),
        ))
        .map_err(|_| AppError::new("logging", "ログレベルを変更できませんでした。"))?;
    Ok(settings)
}
