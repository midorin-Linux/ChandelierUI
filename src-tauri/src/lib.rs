mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(commands::http_client().expect("could not initialize chat HTTP client"))
        .invoke_handler(tauri::generate_handler![
            commands::chat_completion,
            commands::list_models
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
