mod commands;
mod storage;
mod types;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(commands::http_client().expect("could not initialize chat HTTP client"))
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let db = tauri::async_runtime::block_on(storage::open(&dir.join("chandelier.db")))?;
            app.manage(db);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::chat_completion,
            commands::cancel_chat,
            commands::list_models,
            commands::secrets::set_api_key,
            commands::secrets::delete_api_key,
            commands::secrets::has_api_key,
            commands::settings::get_settings,
            commands::settings::set_setting,
            commands::sessions::list_sessions,
            commands::sessions::create_session,
            commands::sessions::load_session,
            commands::sessions::save_session,
            commands::sessions::rename_session,
            commands::sessions::delete_session,
            commands::sessions::append_attempt,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
