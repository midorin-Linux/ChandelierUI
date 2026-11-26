pub mod attempts;
pub mod sessions;
mod settings;
#[cfg(test)]
pub(crate) mod tests;
mod types;

use std::{
    path::Path,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

pub use settings::{get_all as get_settings, set as set_setting};
use sqlx::sqlite::{
    SqliteConnectOptions, SqliteJournalMode, SqlitePool, SqlitePoolOptions, SqliteSynchronous,
};
pub use types::{LoadedSession, SessionData, SessionSummary};

pub struct Db(pub SqlitePool);

#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error("database error: {0}")]
    Sqlx(#[from] sqlx::Error),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("invalid input: {0}")]
    Invalid(String),
}

pub(crate) fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as i64)
}

pub async fn open(path: &Path) -> Result<Db, sqlx::Error> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .foreign_keys(true) // off by default in SQLite; ON DELETE CASCADE needs it
        .busy_timeout(Duration::from_secs(5));
    let pool = SqlitePoolOptions::new()
        .max_connections(4)
        .connect_with(options)
        .await?;
    sqlx::migrate!("./migrations").run(&pool).await?;
    Ok(Db(pool))
}
