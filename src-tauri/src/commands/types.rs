use serde::{Deserialize, Serialize};

pub(crate) use crate::types::{Message, ReasoningEffort, Role};

#[derive(Debug, Serialize, PartialEq)]
pub struct CompletionDelta {
    pub(super) content: String,
    pub(super) reasoning: String,
}

#[derive(Deserialize)]
pub struct Provider {
    /// Saved preset id. When set, the backend takes the base URL from the preset
    /// and the API key from the keyring (see `providers::resolve`).
    #[serde(default)]
    pub(super) id: Option<String>,
    /// Used only when `id` is absent.
    #[serde(default)]
    pub(super) base_url: Option<String>,
    /// Loaded from the keyring in the backend; never accepted over IPC.
    #[serde(skip)]
    pub(super) api_key: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, PartialEq)]
pub struct Model {
    pub(super) id: String,
    #[serde(
        default,
        deserialize_with = "positive_context_length",
        skip_serializing_if = "Option::is_none"
    )]
    pub(super) context_length: Option<u64>,
}

#[derive(Deserialize)]
pub(super) struct Models {
    pub(super) data: Vec<Model>,
}

fn positive_context_length<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<u64>, D::Error> {
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(value.as_u64().filter(|length| *length > 0))
}

#[derive(Deserialize)]
pub struct ChatRequest {
    pub(super) model: String,
    pub(super) messages: Vec<Message>,
    pub(super) reasoning_effort: ReasoningEffort,
}

#[derive(Deserialize)]
pub struct ChatPayload {
    pub(super) provider: Provider,
    pub(super) request: ChatRequest,
}

#[derive(Serialize)]
pub(super) struct WireRequest<'a> {
    pub(super) model: &'a str,
    #[serde(serialize_with = "serialize_wire_messages")]
    pub(super) messages: &'a [Message],
    pub(super) reasoning_effort: &'a str,
    pub(super) stream: bool,
    pub(super) stream_options: StreamOptions,
}

fn serialize_wire_messages<S: serde::Serializer>(
    messages: &[Message],
    serializer: S,
) -> Result<S::Ok, S::Error> {
    #[derive(Serialize)]
    struct WireMessage<'a> {
        role: &'a Role,
        content: &'a str,
    }
    serializer.collect_seq(messages.iter().map(|message| WireMessage {
        role: &message.role,
        content: &message.content,
    }))
}

#[derive(Serialize)]
pub(super) struct StreamOptions {
    pub(super) include_usage: bool,
}
