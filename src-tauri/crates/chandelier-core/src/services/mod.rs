pub mod configuration;
pub mod parameters;

use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};

use serde_json::{Value, json};
use tokio::sync::{Mutex, mpsc, oneshot};
use tokio_util::sync::CancellationToken;

use crate::{
    domain::*,
    infrastructure::{
        database::Db,
        http::{ApiEventKind, OpenAiAdapter, validate_model_identifier, validate_provider},
    },
    telemetry::GenerationTelemetry,
};

#[derive(Clone)]
pub struct ChatService {
    pub db: Db,
    active: Arc<Mutex<HashMap<String, CancellationToken>>>,
}

impl ChatService {
    pub fn new(db: Db) -> Self {
        Self {
            db,
            active: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn cancel(&self, session_id: &str) -> Result<()> {
        if let Some(token) = self.active.lock().await.get(session_id) {
            token.cancel();
        }
        Ok(())
    }

    pub async fn generate(
        &self,
        input: GenerateInput,
        credentials: impl FnOnce(&Provider) -> Result<Option<String>> + Send,
        emit: impl FnMut(StreamEvent) -> Result<()> + Send,
    ) -> Result<()> {
        let token = CancellationToken::new();
        {
            let mut active = self.active.lock().await;
            if active.contains_key(&input.session_id) {
                return Err(AppError::new("busy", "このセッションは生成中です。"));
            }
            active.insert(input.session_id.clone(), token.clone());
        }
        let result = self.run(&input, token, credentials, emit).await;
        self.active.lock().await.remove(&input.session_id);
        result
    }

    async fn run(
        &self,
        input: &GenerateInput,
        cancel: CancellationToken,
        credentials: impl FnOnce(&Provider) -> Result<Option<String>> + Send,
        mut emit: impl FnMut(StreamEvent) -> Result<()> + Send,
    ) -> Result<()> {
        let detail = self.db.session(&input.session_id).await?;
        let model = self
            .db
            .models()
            .await?
            .into_iter()
            .find(|m| Some(&m.id) == detail.session.selected_model_id.as_ref())
            .ok_or_else(|| AppError::validation("モデルを選択してください。"))?;
        let provider = self
            .db
            .providers()
            .await?
            .into_iter()
            .find(|p| p.id == model.provider_id)
            .ok_or_else(|| AppError::validation("プロバイダーが見つかりません。"))?;
        let settings = self.db.settings().await?;
        let body = request_body(input, &detail, &provider, &model, &settings)?;
        let sent_parameters = Value::Object(
            body.as_object()
                .expect("request object")
                .iter()
                .filter(|(key, _)| key.as_str() != "messages")
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect(),
        );
        let mut snapshot = json!({
            "endpoint_type":"chat_completions", "base_url":provider.base_url,
            "provider_name":provider.name, "model_display_name":model.display_name,
            "context_window":model.context_window,
        });
        snapshot["body"] = body;
        let (message, generation) = self
            .db
            .begin_generation(input, &provider, &model, &sent_parameters, &snapshot)
            .await?;
        tracing::info!(generation_id = %generation.id, session_id = %input.session_id,
            provider_id = %provider.id, model_id = %model.id, "Generation started");
        let body = snapshot["body"].take();
        let mut telemetry = GenerationTelemetry::new(generation.id.clone(), model.context_window);
        let mut sequence = 0;
        let mut channel_error = None;
        let mut send = |kind: &str,
                        delta: Option<String>,
                        metrics: Option<GenerationMetrics>,
                        error: Option<AppError>| {
            sequence += 1;
            if channel_error.is_none()
                && let Err(error) = emit(StreamEvent {
                    generation_id: generation.id.clone(),
                    session_id: input.session_id.clone(),
                    sequence,
                    kind: kind.into(),
                    message_id: Some(message.id.clone()),
                    delta,
                    metrics,
                    error,
                })
            {
                channel_error = Some(error);
                cancel.cancel();
            }
        };
        send("started", None, Some(telemetry.metrics().clone()), None);
        let key = credentials(&provider).and_then(|key| {
            validate_provider(&provider)?;
            validate_model_identifier(&model.model_identifier)?;
            if provider.authentication_mode == "bearer"
                && key
                    .as_deref()
                    .is_none_or(|key| key.trim().is_empty() || key.chars().any(char::is_control))
            {
                return Err(AppError::new(
                    "authentication",
                    "APIキーを確認してください。",
                ));
            }
            Ok(key)
        });
        let (content, finish_reason, outcome) = match key {
            Err(error) => (String::new(), None, Err(error)),
            Ok(_) if cancel.is_cancelled() => (
                String::new(),
                None,
                Err(AppError::new("cancelled", "生成をキャンセルしました。")),
            ),
            Ok(key) => {
                self.stream_generation(
                    provider,
                    key,
                    body,
                    cancel.clone(),
                    &mut telemetry,
                    &mut send,
                )
                .await
            }
        };
        let (status, kind, error) = terminal(&outcome);
        self.db
            .final_generation(
                &generation.id,
                &content,
                status,
                finish_reason.as_deref(),
                error,
                telemetry.metrics(),
            )
            .await?;
        tracing::info!(generation_id = %generation.id, session_id = %input.session_id,
            provider_id = %generation.provider_id, model_id = %generation.model_id,
            status, error_code = error.map(|error| error.code.as_str()).unwrap_or(""), "Generation finished");
        send(
            kind,
            None,
            Some(telemetry.metrics().clone()),
            error.cloned(),
        );
        drop(send);
        channel_error.map_or(Ok(()), Err)
    }

    async fn stream_generation(
        &self,
        provider: Provider,
        key: Option<String>,
        body: Value,
        cancel: CancellationToken,
        telemetry: &mut GenerationTelemetry,
        send: &mut (
                 impl FnMut(&str, Option<String>, Option<GenerationMetrics>, Option<AppError>) + Send
             ),
    ) -> (String, Option<String>, Result<()>) {
        let (tx, mut rx) = mpsc::channel(32);
        let (started_tx, started_rx) = oneshot::channel();
        let child_cancel = cancel.clone();
        let task = tokio::spawn(async move {
            let _ = started_tx.send(Instant::now());
            let outcome =
                OpenAiAdapter::stream(&provider, key.as_deref(), &body, child_cancel, tx).await;
            (outcome, Instant::now())
        });
        if let Ok(at) = started_rx.await {
            telemetry.start(at);
        }
        let mut content = String::new();
        let mut finish_reason = None;
        let mut dirty = false;
        let mut storage_error = None;
        let mut observation_error = None;
        let mut interval = tokio::time::interval(Duration::from_millis(350));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tokio::select! {
                event = rx.recv() => {
                    let Some(event) = event else { break; };
                    if observation_error.is_some() { continue; }
                    match telemetry.observe(&event) {
                        Ok(changed) => dirty |= changed,
                        Err(error) => {
                            observation_error = Some((error, event.at));
                            cancel.cancel();
                            continue;
                        }
                    }
                    match event.kind {
                        ApiEventKind::Content(delta) => {
                            content.push_str(&delta);
                            send("delta", Some(delta), Some(telemetry.metrics().clone()), None);
                        }
                        ApiEventKind::Usage(_) => send("usage", None, Some(telemetry.metrics().clone()), None),
                        ApiEventKind::Finish(reason) => finish_reason = Some(reason),
                        _ => {}
                    }
                }
                _ = interval.tick(), if dirty && storage_error.is_none() => {
                    let saved = async {
                        self.db.checkpoint(&telemetry.metrics().generation_id, &content).await?;
                        self.db.save_metrics(telemetry.metrics()).await
                    }.await;
                    if let Err(error) = saved {
                        storage_error = Some(error);
                        cancel.cancel();
                    }
                    dirty = false;
                }
            }
        }
        let (outcome, at) = task.await.unwrap_or_else(|_| {
            (
                Err(AppError::new("internal", "生成処理が中断されました。")),
                Instant::now(),
            )
        });
        let (outcome, at) = observation_error.map_or((outcome, at), |(error, at)| (Err(error), at));
        telemetry.finish(at, outcome.is_ok());
        (content, finish_reason, storage_error.map_or(outcome, Err))
    }
}

fn terminal(outcome: &Result<()>) -> (&'static str, &'static str, Option<&AppError>) {
    match outcome {
        Ok(()) => ("completed", "completed", None),
        Err(error) if error.code == "cancelled" => ("cancelled", "cancelled", Some(error)),
        Err(error) => ("failed", "error", Some(error)),
    }
}

fn request_body(
    input: &GenerateInput,
    detail: &SessionDetail,
    provider: &Provider,
    model: &Model,
    settings: &Value,
) -> Result<Value> {
    let empty = json!({});
    let mut parameters = parameters::merge(&[
        settings.get("generation").unwrap_or(&empty),
        &provider.default_parameters,
        &model.default_parameters,
        &detail.session.session_settings,
        &input.parameters,
    ])?;
    let system_prompt = parameters.remove("system_prompt");
    if let Some(unsupported) = model
        .capabilities
        .get("unsupported_parameters")
        .and_then(Value::as_array)
    {
        for name in unsupported.iter().filter_map(Value::as_str) {
            parameters.remove(name);
        }
    }
    if model
        .capabilities
        .get("max_tokens_parameter")
        .and_then(Value::as_str)
        == Some("max_tokens")
        && let Some(value) = parameters.remove("max_completion_tokens")
    {
        parameters.insert("max_tokens".into(), value);
    }
    let mut messages = Vec::new();
    if let Some(prompt) = system_prompt.filter(|p| p.as_str().is_some_and(|s| !s.is_empty())) {
        messages.push(json!({"role":"system","content":prompt}));
    }
    let end = match input.action.as_str() {
        "send" => detail.messages.len(),
        "regenerate" => detail
            .messages
            .len()
            .checked_sub(1)
            .filter(|_| {
                detail
                    .messages
                    .last()
                    .is_some_and(|m| m.role == "assistant")
            })
            .ok_or_else(|| AppError::validation("再生成する応答がありません。"))?,
        "edit" => detail
            .messages
            .iter()
            .position(|m| Some(&m.id) == input.message_id.as_ref() && m.role == "user")
            .ok_or_else(|| AppError::validation("編集対象が見つかりません。"))?,
        _ => return Err(AppError::validation("生成操作が不正です。")),
    };
    for message in &detail.messages[.. end] {
        messages.push(json!({"role":message.role,"content":message.content}));
    }
    if input.action != "regenerate" {
        let text = input
            .content
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .ok_or_else(|| AppError::validation("メッセージを入力してください。"))?;
        messages.push(json!({"role":"user","content":text}));
    }
    parameters.insert("messages".into(), Value::Array(messages));
    parameters.insert(
        "model".into(),
        Value::String(model.model_identifier.clone()),
    );
    parameters.insert("stream".into(), Value::Bool(true));
    if provider.supports_usage {
        parameters.insert("stream_options".into(), json!({"include_usage":true}));
    }
    Ok(Value::Object(parameters))
}
