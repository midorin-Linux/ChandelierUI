use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::FromRow;

use crate::types::{Message, ReasoningEffort};

/// `sessions.data` at `schema_version` 1.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct SessionData {
    pub model: String,
    pub reasoning_effort: ReasoningEffort,
    pub system_prompt: String,
    pub messages: Vec<Message>,
}

#[derive(Debug, Clone, Serialize, FromRow, PartialEq)]
pub struct SessionSummary {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize)]
pub struct LoadedSession {
    pub summary: SessionSummary,
    pub data: SessionData,
    pub attempts: Vec<Value>,
}
