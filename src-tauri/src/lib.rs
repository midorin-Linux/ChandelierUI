mod commands;

use chandelier_core::{
    infrastructure::database::Db,
    services::{ChatService, configuration},
};
use tauri::Manager;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

fn log_filter(level: &str) -> tracing_subscriber::EnvFilter {
    tracing_subscriber::EnvFilter::new(format!(
        "off,chandelier_core={level},chandelier_ui_lib={level}"
    ))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let (filter, log_handle) = tracing_subscriber::reload::Layer::new(log_filter("info"));
    tracing_subscriber::registry()
        .with(filter)
        .with(tracing_subscriber::fmt::layer().with_target(false))
        .init();
    tauri::Builder::default()
        .setup(move |app| {
            let directory = app.path().app_data_dir()?;
            std::fs::create_dir_all(&directory)?;
            let lock = std::fs::OpenOptions::new()
                .create(true)
                .truncate(false)
                .read(true)
                .write(true)
                .open(directory.join("chandelier.lock"))?;
            lock.try_lock()
                .map_err(|_| std::io::Error::other("Chandelier UI is already running"))?;
            app.manage(lock);
            let db =
                tauri::async_runtime::block_on(Db::open(&directory.join("chandelier.sqlite3")))?;
            let settings = tauri::async_runtime::block_on(configuration::bootstrap_settings(&db))?;
            log_handle.reload(log_filter(settings["log_level"].as_str().unwrap_or("info")))?;
            app.manage(commands::AppState {
                chat: ChatService::new(db.clone()),
                db,
                data_directory: directory.to_string_lossy().into_owned(),
                log_filter: log_handle.clone(),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap,
            commands::create_session,
            commands::session_detail,
            commands::generation_message,
            commands::update_session,
            commands::delete_session,
            commands::generate,
            commands::cancel_generation,
            commands::save_provider,
            commands::delete_provider,
            commands::test_provider,
            commands::refresh_models,
            commands::save_model,
            commands::delete_model,
            commands::save_settings,
        ])
        .run(tauri::generate_context!())
        .expect("Chandelier UI could not start");
}
