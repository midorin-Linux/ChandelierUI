mod settings;
#[cfg(test)]
mod tests;

use std::{
    fmt,
    path::Path,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

pub use settings::{get_all as get_settings, set as set_setting};
use sqlx::sqlite::{
    SqliteConnectOptions, SqliteJournalMode, SqlitePool, SqlitePoolOptions, SqliteSynchronous,
};

pub struct Db(pub SqlitePool);

#[derive(Debug)]
pub enum StorageError {
    Sqlx(sqlx::Error),
    Invalid(String),
}

impl fmt::Display for StorageError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Sqlx(error) => write!(f, "database error: {error}"),
            Self::Invalid(reason) => write!(f, "invalid input: {reason}"),
        }
    }
}

impl std::error::Error for StorageError {}

impl From<sqlx::Error> for StorageError {
    fn from(error: sqlx::Error) -> Self {
        Self::Sqlx(error)
    }
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
