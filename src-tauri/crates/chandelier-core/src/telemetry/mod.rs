use std::time::Instant;

use serde_json::{Map, Value};

use crate::{
    domain::{AppError, GenerationMetrics, MAX_SAFE_INTEGER, Result},
    infrastructure::http::{ApiEvent, ApiEventKind},
};

/// Client observations only: no character, frame, or estimated token counts.
pub struct GenerationTelemetry {
    metrics: GenerationMetrics,
    started: Option<Instant>,
    first_content: Option<Instant>,
    last_event: Option<Instant>,
    reported_total: Option<u64>,
}

impl GenerationTelemetry {
    pub fn new(generation_id: String, context_window: Option<i64>) -> Self {
        Self {
            metrics: GenerationMetrics {
                generation_id,
                context_window: context_window
                    .and_then(|value| u64::try_from(value).ok())
                    .filter(|value| *value > 0 && *value <= MAX_SAFE_INTEGER),
                usage_source: "unavailable".into(),
                ..Default::default()
            },
            started: None,
            first_content: None,
            last_event: None,
            reported_total: None,
        }
    }

    pub fn start(&mut self, at: Instant) {
        self.started = Some(at);
    }

    pub fn metrics(&self) -> &GenerationMetrics {
        &self.metrics
    }

    /// Returns whether an observation can change persisted metrics.
    pub fn observe(&mut self, event: &ApiEvent) -> Result<bool> {
        let elapsed = self.started.and_then(|start| milliseconds(start, event.at));
        match &event.kind {
            ApiEventKind::Headers if self.metrics.request_latency_ms.is_none() => {
                self.metrics.request_latency_ms = elapsed
            }
            ApiEventKind::Event => {
                self.last_event = Some(event.at);
                if self.metrics.first_event_ms.is_none() {
                    self.metrics.first_event_ms = elapsed;
                }
            }
            ApiEventKind::Content(text) if !text.is_empty() => {
                let first = *self.first_content.get_or_insert(event.at);
                if self.metrics.ttft_ms.is_none() {
                    self.metrics.ttft_ms = elapsed;
                }
                self.metrics.generation_duration_ms = milliseconds(first, event.at);
                self.update_derived();
            }
            ApiEventKind::Usage(usage) => self.usage(usage)?,
            _ => return Ok(false),
        }
        Ok(true)
    }

    /// Successful streams end at the observed DONE event, not at queue-drain time.
    pub fn finish(&mut self, at: Instant, completed: bool) {
        let terminal = if completed {
            self.last_event.unwrap_or(at)
        } else {
            at
        };
        self.metrics.total_duration_ms =
            self.started.and_then(|start| milliseconds(start, terminal));
    }

    fn usage(&mut self, usage: &Value) -> Result<()> {
        let object = usage.as_object().ok_or_else(format_error)?;
        let input = count(object, "prompt_tokens")?;
        let output = count(object, "completion_tokens")?;
        let total = count(object, "total_tokens")?;
        let cached = detail_count(object, "prompt_tokens_details", "cached_tokens")?;
        let reasoning = detail_count(object, "completion_tokens_details", "reasoning_tokens")?;
        let input = input.or(self.metrics.input_tokens);
        let output = output.or(self.metrics.output_tokens);
        let reported_total = total.or(self.reported_total);
        let total = match (reported_total, input, output) {
            (Some(total), _, _) => Some(total),
            (None, Some(input), Some(output)) => Some(
                input
                    .checked_add(output)
                    .filter(|value| *value <= MAX_SAFE_INTEGER)
                    .ok_or_else(format_error)?,
            ),
            _ => None,
        };
        self.metrics.input_tokens = input;
        self.metrics.output_tokens = output;
        self.metrics.total_tokens = total;
        self.metrics.cached_tokens = cached.or(self.metrics.cached_tokens);
        self.metrics.reasoning_tokens = reasoning.or(self.metrics.reasoning_tokens);
        self.reported_total = reported_total;
        if [
            input,
            output,
            total,
            self.metrics.cached_tokens,
            self.metrics.reasoning_tokens,
        ]
        .iter()
        .any(Option::is_some)
        {
            self.metrics.usage_source = "api".into();
        }
        self.update_derived();
        Ok(())
    }

    fn update_derived(&mut self) {
        self.metrics.generation_throughput = self
            .metrics
            .output_tokens
            .zip(self.metrics.generation_duration_ms)
            .filter(|(_, duration)| *duration > 0.0)
            .and_then(|(tokens, duration)| finite(tokens as f64 / (duration / 1000.0)));
        if let Some((input, window)) = self.metrics.input_tokens.zip(self.metrics.context_window) {
            self.metrics.context_usage_percent = finite(input as f64 / window as f64 * 100.0);
            self.metrics.remaining_context = Some(window.saturating_sub(input));
        }
    }
}

fn count(object: &Map<String, Value>, name: &str) -> Result<Option<u64>> {
    match object.get(name) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_u64()
            .filter(|value| *value <= MAX_SAFE_INTEGER)
            .map(Some)
            .ok_or_else(format_error),
    }
}

fn detail_count(object: &Map<String, Value>, name: &str, field: &str) -> Result<Option<u64>> {
    match object.get(name) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => count(value.as_object().ok_or_else(format_error)?, field),
    }
}

fn milliseconds(start: Instant, end: Instant) -> Option<f64> {
    end.checked_duration_since(start)
        .and_then(|duration| finite(duration.as_secs_f64() * 1000.0))
}
fn finite(value: f64) -> Option<f64> {
    value.is_finite().then_some(value)
}
fn format_error() -> AppError {
    AppError::new("format", "APIのトークン使用量の形式が不正です。")
}
