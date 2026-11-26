//! The error every command returns. It crosses IPC as `{ kind, message }`, so the
//! webview can tell what went wrong by `kind` and show `message`.

use serde::{Serialize, Serializer};

use crate::storage::StorageError;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Storage(#[from] StorageError),
    #[error("Could not access the system keyring: {0}")]
    Keyring(#[from] keyring::Error),
    #[error("Could not access the system keyring: {0}")]
    KeyringTask(tokio::task::JoinError),
    #[error("{0}")]
    InvalidInput(&'static str),
    #[error("Saved provider presets are invalid: {0}")]
    InvalidPresets(serde_json::Error),
    #[error("Unknown provider preset: {0}")]
    UnknownPreset(String),
    #[error("{0}")]
    Network(&'static str),
    #[error("{0}")]
    Timeout(&'static str),
    #[error("Generation cancelled.")]
    Cancelled,
    /// The provider answered with a non-2xx status; the text names it.
    #[error("{0}")]
    HttpStatus(String),
    /// The provider answered, but not with a valid model list or completion stream.
    #[error("{0}")]
    InvalidResponse(&'static str),
    /// The provider reported an error or refusal inside a well-formed stream.
    #[error("{0}")]
    ProviderReported(&'static str),
    #[error("Could not deliver the chat response to the UI.")]
    Channel,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorKind {
    Database,
    NotFound,
    InvalidInput,
    Keyring,
    Preset,
    Network,
    Timeout,
    Cancelled,
    HttpStatus,
    InvalidResponse,
    ProviderError,
    Channel,
}

impl Error {
    pub fn kind(&self) -> ErrorKind {
        match self {
            Self::Storage(StorageError::Sqlx(_)) => ErrorKind::Database,
            Self::Storage(StorageError::NotFound(_)) => ErrorKind::NotFound,
            Self::Storage(StorageError::Invalid(_)) | Self::InvalidInput(_) => {
                ErrorKind::InvalidInput
            }
            Self::Keyring(_) | Self::KeyringTask(_) => ErrorKind::Keyring,
            Self::InvalidPresets(_) | Self::UnknownPreset(_) => ErrorKind::Preset,
            Self::Network(_) => ErrorKind::Network,
            Self::Timeout(_) => ErrorKind::Timeout,
            Self::Cancelled => ErrorKind::Cancelled,
            Self::HttpStatus(_) => ErrorKind::HttpStatus,
            Self::InvalidResponse(_) => ErrorKind::InvalidResponse,
            Self::ProviderReported(_) => ErrorKind::ProviderError,
            Self::Channel => ErrorKind::Channel,
        }
    }
}

/// The wire shape of `Error`; its sources (`sqlx::Error`, ...) are not `Serialize`.
#[derive(Serialize)]
struct IpcError {
    kind: ErrorKind,
    message: String,
}

impl Serialize for Error {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        IpcError {
            kind: self.kind(),
            message: self.to_string(),
        }
        .serialize(serializer)
    }
}
