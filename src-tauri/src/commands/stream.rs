use std::borrow::Cow;

use serde::Deserialize;

use super::{
    metrics::{ChunkIntervals, CompletionMetrics, MeasuredCompletion},
    types::{CompletionDelta, Message, Role},
};
use crate::error::Error;

#[derive(Deserialize)]
struct StreamEvent<'a> {
    #[serde(borrow)]
    choices: Option<ChoiceList<'a>>,
    usage: Option<Usage>,
    timings: Option<ServerTimings>,
    error: Option<serde::de::IgnoredAny>,
}

struct ChoiceList<'a>(Option<StreamChoice<'a>>);

impl<'de: 'a, 'a> Deserialize<'de> for ChoiceList<'a> {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct ChoicesVisitor<'a>(std::marker::PhantomData<&'a ()>);
        impl<'de: 'a, 'a> serde::de::Visitor<'de> for ChoicesVisitor<'a> {
            type Value = ChoiceList<'a>;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("at most one completion choice")
            }

            fn visit_seq<A: serde::de::SeqAccess<'de>>(
                self,
                mut sequence: A,
            ) -> Result<Self::Value, A::Error> {
                let choice = sequence.next_element()?;
                if sequence.next_element::<serde::de::IgnoredAny>()?.is_some() {
                    return Err(serde::de::Error::custom("multiple completion choices"));
                }
                Ok(ChoiceList(choice))
            }
        }
        deserializer.deserialize_seq(ChoicesVisitor(std::marker::PhantomData))
    }
}

#[derive(Deserialize)]
#[serde(transparent)]
struct StreamText<'a>(#[serde(borrow)] Cow<'a, str>);

impl std::ops::Deref for StreamText<'_> {
    type Target = str;

    fn deref(&self) -> &str {
        &self.0
    }
}

#[derive(Deserialize)]
struct StreamChoice<'a> {
    index: u64,
    #[serde(borrow)]
    delta: Delta<'a>,
    #[serde(borrow)]
    finish_reason: Option<StreamText<'a>>,
}

#[derive(Default, Deserialize)]
struct Delta<'a> {
    #[serde(borrow)]
    role: Option<StreamText<'a>>,
    #[serde(borrow)]
    content: Option<StreamText<'a>>,
    #[serde(borrow)]
    reasoning_content: Option<StreamText<'a>>,
    #[serde(borrow)]
    reasoning: Option<StreamText<'a>>,
    #[serde(borrow)]
    refusal: Option<StreamText<'a>>,
}

#[derive(Deserialize)]
struct Usage {
    prompt_tokens: Option<u64>,
    completion_tokens: Option<u64>,
    total_tokens: Option<u64>,
    prompt_tokens_details: Option<PromptDetails>,
    completion_tokens_details: Option<CompletionDetails>,
}

#[derive(Deserialize)]
struct PromptDetails {
    cached_tokens: Option<u64>,
}

#[derive(Deserialize)]
struct CompletionDetails {
    reasoning_tokens: Option<u64>,
}

#[derive(Deserialize)]
struct ServerTimings {
    prompt_ms: Option<f64>,
    predicted_ms: Option<f64>,
}

#[derive(Default)]
pub(super) struct CompletionStream {
    pub(super) text: String,
    pub(super) reasoning: String,
    pub(super) metrics: CompletionMetrics,
    pub(super) intervals: ChunkIntervals,
}

impl CompletionStream {
    pub(super) fn event(
        &mut self,
        data: &[u8],
        elapsed_ms: f64,
        on_event: &mut impl FnMut(CompletionDelta) -> Result<(), Error>,
    ) -> Result<bool, Error> {
        if data == b"[DONE]" {
            return Ok(true);
        }
        let event: StreamEvent<'_> = serde_json::from_slice(data).map_err(|_| {
            Error::InvalidResponse("Chat provider returned an invalid JSON stream event.")
        })?;
        if event.error.is_some() {
            return Err(Error::ProviderReported(
                "Chat provider returned a stream error.",
            ));
        }
        let choice = event.choices.and_then(|choices| choices.0);
        if choice.is_none() && event.usage.is_none() && event.timings.is_none() {
            return Err(Error::InvalidResponse("Chat provider returned no choices."));
        }
        if let Some(usage) = event.usage {
            if usage.prompt_tokens.is_some() {
                self.metrics.input_tokens = usage.prompt_tokens;
            }
            if usage.completion_tokens.is_some() {
                self.metrics.output_tokens = usage.completion_tokens;
            }
            if usage.total_tokens.is_some() {
                self.metrics.total_tokens = usage.total_tokens;
            }
            if let Some(details) = usage.prompt_tokens_details
                && details.cached_tokens.is_some()
            {
                self.metrics.cached_tokens = details.cached_tokens;
            }
            if let Some(details) = usage.completion_tokens_details
                && details.reasoning_tokens.is_some()
            {
                self.metrics.reasoning_tokens = details.reasoning_tokens;
            }
        }
        if let Some(timings) = event.timings {
            // Provider-reported llama.cpp timings, not client-side phase measurements.
            if let Some(value) = timings
                .prompt_ms
                .filter(|value| value.is_finite() && *value >= 0.0)
            {
                self.metrics.prefill_ms = Some(value);
            }
            if let Some(value) = timings
                .predicted_ms
                .filter(|value| value.is_finite() && *value >= 0.0)
            {
                self.metrics.server_decode_ms = Some(value);
            }
        }
        if let Some(choice) = choice {
            if choice.index != 0 {
                return Err(Error::InvalidResponse(
                    "Chat provider returned an unexpected choice index.",
                ));
            }
            if choice
                .delta
                .role
                .as_deref()
                .is_some_and(|role| role != "assistant")
            {
                return Err(Error::InvalidResponse(
                    "Chat provider did not return an assistant message.",
                ));
            }
            if choice
                .delta
                .refusal
                .as_deref()
                .is_some_and(|text| !text.trim().is_empty())
            {
                return Err(Error::ProviderReported(
                    "Chat provider refused the request.",
                ));
            }
            let content = choice.delta.content.as_deref().unwrap_or("");
            let reasoning = choice
                .delta
                .reasoning_content
                .as_deref()
                .filter(|text| !text.is_empty())
                .or(choice.delta.reasoning.as_deref())
                .unwrap_or("");
            if self.metrics.finish_reason.is_some()
                && (!content.is_empty() || !reasoning.is_empty())
            {
                return Err(Error::InvalidResponse(
                    "Chat provider returned a choice after its finish reason.",
                ));
            }
            if !content.is_empty() || !reasoning.is_empty() {
                self.metrics.ttft_ms.get_or_insert(elapsed_ms);
                self.intervals.record(elapsed_ms);
                self.text.push_str(content);
                self.reasoning.push_str(reasoning);
                on_event(CompletionDelta {
                    content: content.into(),
                    reasoning: reasoning.into(),
                })?;
            }
            if let Some(reason) = choice.finish_reason {
                if reason.trim().is_empty() {
                    return Err(Error::InvalidResponse(
                        "Chat provider returned an empty finish reason.",
                    ));
                }
                if &*reason == "error" {
                    return Err(Error::ProviderReported(
                        "Chat provider returned an error finish reason.",
                    ));
                }
                if self
                    .metrics
                    .finish_reason
                    .as_deref()
                    .is_some_and(|prev| prev != &*reason)
                {
                    return Err(Error::InvalidResponse(
                        "Chat provider returned a choice after its finish reason.",
                    ));
                }
                if self.metrics.finish_reason.is_none() {
                    self.metrics.finish_reason = Some(reason.0.into_owned());
                }
            }
        }
        Ok(false)
    }

    pub(super) fn validate(&self) -> Result<(), Error> {
        if self.metrics.finish_reason.is_none() {
            return Err(Error::InvalidResponse(
                "Chat provider returned a truncated completion (missing finish_reason).",
            ));
        }
        if self.text.trim().is_empty() {
            return Err(Error::InvalidResponse(
                "Chat provider returned no assistant text (empty or tool-only response).",
            ));
        }
        Ok(())
    }

    pub(super) fn finish(mut self, elapsed_ms: f64, error: Option<Error>) -> MeasuredCompletion {
        self.metrics.e2e_ms = elapsed_ms;
        self.metrics.decode_ms = self
            .metrics
            .ttft_ms
            .map(|first| (elapsed_ms - first).max(0.0));
        if let (Some(tokens), Some(decode_ms)) =
            (self.metrics.output_tokens, self.metrics.decode_ms)
        {
            if tokens > 0 && decode_ms > 0.0 {
                self.metrics.output_tps = Some(tokens as f64 * 1000.0 / decode_ms);
            }
            if tokens > 1 {
                // Derived time per output token; SSE deltas do not expose exact token ITL.
                self.metrics.tpot_ms = Some(decode_ms / (tokens - 1) as f64);
            }
        }
        if self.intervals.count > 0 {
            self.metrics.chunk_interval_mean_ms = Some(self.intervals.mean);
            self.metrics.chunk_interval_max_ms = Some(self.intervals.max);
            self.metrics.chunk_interval_stddev_ms = Some(
                (self.intervals.m2 / self.intervals.count as f64)
                    .max(0.0)
                    .sqrt(),
            );
        }
        MeasuredCompletion {
            message: (!self.text.is_empty() || !self.reasoning.is_empty()).then_some(Message {
                role: Role::Assistant,
                content: self.text,
                reasoning: self.reasoning,
            }),
            error_kind: error.as_ref().map(Error::kind),
            error: error.map(|error| error.to_string()),
            metrics: self.metrics,
        }
    }
}
