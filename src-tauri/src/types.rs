//! Types shared by `commands` (chat) and `storage` (persistence).
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    System,
    User,
    Assistant,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct Message {
    pub(crate) role: Role,
    pub(crate) content: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub(crate) reasoning: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ReasoningEffort {
    #[serde(rename = "off")]
    Off,
    Low,
    Medium,
    High,
    Xhigh,
    Max,
}

impl ReasoningEffort {
    pub(crate) fn wire(&self) -> &'static str {
        match self {
            Self::Off => "none",
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
            Self::Xhigh | Self::Max => "xhigh",
        }
    }
}
