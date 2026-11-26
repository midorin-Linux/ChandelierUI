mod commands;
mod error;
mod storage;
mod types;

use std::path::PathBuf;

use tauri::Manager;
use tracing_appender::rolling;
use tracing_subscriber::{EnvFilter, fmt, prelude::*};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(desktop)]
    let builder = builder
        // Must be the first plugin registered.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        );

    builder
        .plugin(tauri_plugin_opener::init())
        .manage(commands::http_client().expect("could not initialize chat HTTP client"))
        .setup(|app| {
            let log_dir = app.path().app_log_dir().ok();
            init_logging(log_dir.clone());
            tracing::info!(version = %app.package_info().version, ?log_dir, "starting");
            let db = open_db(app)
                .inspect_err(|error| tracing::error!(%error, "could not open the database"))?;
            app.manage(db);
            Ok(())
        })
        .invoke_handler(specta_builder().invoke_handler())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn open_db(app: &tauri::App) -> Result<storage::Db, Box<dyn std::error::Error>> {
    let dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&dir)?;
    Ok(tauri::async_runtime::block_on(storage::open(
        &dir.join("chandelier.db"),
    ))?)
}

/// Logs to `dir/chandelier.YYYY-MM-DD.log` (rotated daily, 7 files kept) and, in
/// debug builds, to stderr. `RUST_LOG` overrides the default filter. Without a
/// usable `dir` the app runs without file logging.
fn init_logging(dir: Option<PathBuf>) {
    // Written synchronously: a non-blocking writer loses its last lines, since
    // `App::run` exits the process and release builds abort on panic.
    let file = dir.and_then(|dir| {
        // tracing-appender lists the directory to prune old logs before creating
        // it; a failure here resurfaces from `build`.
        let _ = std::fs::create_dir_all(&dir);
        rolling::Builder::new()
            .rotation(rolling::Rotation::DAILY)
            .filename_prefix("chandelier")
            .filename_suffix("log")
            .max_log_files(7)
            .build(dir)
            .inspect_err(|error| eprintln!("file logging disabled: {error}"))
            .ok()
            .map(|appender| fmt::layer().with_ansi(false).with_writer(appender))
    });
    let stderr = cfg!(debug_assertions).then(|| fmt::layer().with_writer(std::io::stderr));
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("warn,chandelier_ui_lib=info"));
    if tracing_subscriber::registry()
        .with(filter)
        .with(file)
        .with(stderr)
        .try_init()
        .is_ok()
    {
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            tracing::error!("{info}");
            previous(info);
        }));
    }
}

/// Every command the webview can call; `src/bindings.ts` is generated from it
/// by `tests/bindings.rs`.
pub fn specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::new()
        .commands(tauri_specta::collect_commands![
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
        // Commands reject with this (see `error::Error`); typed bindings don't name it.
        .typ::<error::IpcError>()
}
