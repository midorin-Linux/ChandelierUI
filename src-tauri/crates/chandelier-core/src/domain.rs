use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Session {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub selected_model_id: Option<String>,
    pub session_settings: sqlx::types::Json<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Message {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub ordinal: i64,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Generation {
    pub id: String,
    pub message_id: String,
    pub provider_id: String,
    pub model_id: String,
    pub status: String,
    pub request_parameters: sqlx::types::Json<Value>,
    pub request_snapshot: sqlx::types::Json<Value>,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub finish_reason: Option<String>,
    pub error: Option<sqlx::types::Json<AppError>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GenerationMetrics {
    pub generation_id: String,
    pub request_latency_ms: Option<f64>,
    pub first_event_ms: Option<f64>,
    pub ttft_ms: Option<f64>,
    pub generation_duration_ms: Option<f64>,
    pub total_duration_ms: Option<f64>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub total_tokens: Option<u64>,
    pub cached_tokens: Option<u64>,
    pub reasoning_tokens: Option<u64>,
    pub context_window: Option<u64>,
    pub output_tps: Option<f64>,
    pub generation_throughput: Option<f64>,
    pub context_usage_percent: Option<f64>,
    pub remaining_context: Option<u64>,
    pub usage_source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub authentication_mode: String,
    pub credential_reference: Option<String>,
    pub timeout_seconds: i64,
    pub supports_usage: bool,
    pub default_parameters: sqlx::types::Json<Value>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Model {
    pub id: String,
    pub provider_id: String,
    pub model_identifier: String,
    pub display_name: String,
    pub context_window: Option<i64>,
    pub capabilities: sqlx::types::Json<Value>,
    pub default_parameters: sqlx::types::Json<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionDetail {
    pub session: Session,
    pub messages: Vec<Message>,
    pub generations: Vec<Generation>,
    pub metrics: Vec<GenerationMetrics>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bootstrap {
    pub sessions: Vec<Session>,
    pub providers: Vec<Provider>,
    pub models: Vec<Model>,
    pub settings: Value,
    pub data_directory: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppError {
    pub code: String,
    pub message: String,
}

impl AppError {
    pub fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
    pub fn validation(message: &str) -> Self {
        Self::new("validation", message)
    }
}
impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}
impl std::error::Error for AppError {}
impl From<sqlx::Error> for AppError {
    fn from(_: sqlx::Error) -> Self {
        tracing::error!(kind = "database", "Database operation failed");
        Self::new("database", "データベース操作に失敗しました。")
    }
}
impl From<serde_json::Error> for AppError {
    fn from(_: serde_json::Error) -> Self {
        Self::new("format", "保存データまたはAPIの形式が不正です。")
    }
}
pub type Result<T, E = AppError> = std::result::Result<T, E>;
pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
pub fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateInput {
    pub session_id: String,
    pub action: String,
    pub content: Option<String>,
    pub message_id: Option<String>,
    pub parameters: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamEvent {
    pub generation_id: String,
    pub session_id: String,
    pub sequence: u64,
    pub kind: String,
    pub message_id: Option<String>,
    pub delta: Option<String>,
    pub metrics: Option<GenerationMetrics>,
    pub error: Option<AppError>,
}
