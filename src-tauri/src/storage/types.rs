use std::collections::{BTreeMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::FromRow;

use super::StorageError;
use crate::types::ReasoningEffort;

/// Nodes are user or assistant only; the system prompt is a session field.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum NodeRole {
    User,
    Assistant,
}

/// An immutable message in the session tree. `parent_id` is `null` for a root.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct MessageNode {
    pub id: String,
    pub parent_id: Option<String>,
    pub role: NodeRole,
    pub content: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub reasoning: String,
    pub created_at: i64,
}

/// `sessions.data` at `schema_version` 2.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct SessionData {
    pub model: String,
    pub reasoning_effort: ReasoningEffort,
    pub system_prompt: String,
    /// Append-only; a parent always comes before its children.
    pub messages: Vec<MessageNode>,
    /// Branch name -> head message id.
    pub branches: BTreeMap<String, Option<String>>,
    pub current_branch: String,
}

impl SessionData {
    /// Ids are unique, parents come earlier (so there are no cycles), branch heads exist
    /// and the current branch exists. Several roots are allowed on purpose.
    pub fn validate(&self) -> Result<(), StorageError> {
        let invalid = |reason: String| Err(StorageError::Invalid(reason));
        let mut seen = HashSet::new();
        for node in &self.messages {
            if let Some(parent) = &node.parent_id
                && !seen.contains(parent.as_str())
            {
                return invalid(format!(
                    "message {} has parent {parent}, which is not an earlier message",
                    node.id
                ));
            }
            if !seen.insert(node.id.as_str()) {
                return invalid(format!("duplicate message id {}", node.id));
            }
        }
        for (name, head) in &self.branches {
            if let Some(head) = head
                && !seen.contains(head.as_str())
            {
                return invalid(format!("branch {name} points at missing message {head}"));
            }
        }
        if !self.branches.contains_key(&self.current_branch) {
            return invalid(format!(
                "current branch {} does not exist",
                self.current_branch
            ));
        }
        Ok(())
    }
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
