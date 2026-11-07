use std::time::{Duration, Instant};

use chandelier_core::{
    domain::MAX_SAFE_INTEGER,
    infrastructure::http::{ApiEvent, ApiEventKind},
    telemetry::GenerationTelemetry,
};
use serde_json::{Value, json};

fn observe(telemetry: &mut GenerationTelemetry, start: Instant, ms: u64, kind: ApiEventKind) {
    telemetry
        .observe(&ApiEvent {
            at: start + Duration::from_millis(ms),
            kind,
        })
        .unwrap();
}

#[test]
fn observation_times_distinguish_role_content_usage_and_done() {
    let start = Instant::now();
    let mut telemetry = GenerationTelemetry::new("attempt".into(), Some(100));
    telemetry.start(start);
    observe(&mut telemetry, start, 10, ApiEventKind::Headers);
    observe(&mut telemetry, start, 20, ApiEventKind::Event);
    observe(
        &mut telemetry,
        start,
        30,
        ApiEventKind::Content(String::new()),
    );
    assert_eq!(telemetry.metrics().first_event_ms, Some(20.0));
    assert_eq!(telemetry.metrics().ttft_ms, None);
    observe(
        &mut telemetry,
        start,
        40,
        ApiEventKind::Content("first".into()),
    );
    observe(
        &mut telemetry,
        start,
        140,
        ApiEventKind::Content("last".into()),
    );
    observe(
        &mut telemetry,
        start,
        240,
        ApiEventKind::Usage(json!({
            "prompt_tokens":120,"completion_tokens":15,
            "prompt_tokens_details":{"cached_tokens":50},
            "completion_tokens_details":{"reasoning_tokens":10}
        })),
    );
    observe(&mut telemetry, start, 300, ApiEventKind::Event);
    telemetry.finish(start + Duration::from_secs(9), true);
    let metrics = telemetry.metrics();
    assert_eq!(metrics.generation_id, "attempt");
    assert_eq!(metrics.request_latency_ms, Some(10.0));
    assert_eq!(metrics.ttft_ms, Some(40.0));
    assert_eq!(metrics.generation_duration_ms, Some(100.0));
    assert_eq!(metrics.total_duration_ms, Some(300.0));
    assert_eq!(
        (
            metrics.input_tokens,
            metrics.output_tokens,
            metrics.total_tokens
        ),
        (Some(120), Some(15), Some(135))
    );
    assert_eq!(
        (metrics.cached_tokens, metrics.reasoning_tokens),
        (Some(50), Some(10))
    );
    assert_eq!(metrics.generation_throughput, Some(150.0));
    assert_eq!(metrics.output_tps, None);
    assert_eq!(metrics.context_usage_percent, Some(120.0));
    assert_eq!(metrics.remaining_context, Some(0));
    assert_eq!(metrics.usage_source, "api");
}

#[test]
fn failure_and_cancellation_use_terminal_observation_not_last_event() {
    for terminal_ms in [70, 150] {
        let start = Instant::now();
        let mut telemetry = GenerationTelemetry::new("attempt".into(), Some(1000));
        telemetry.start(start);
        observe(&mut telemetry, start, 5, ApiEventKind::Headers);
        observe(&mut telemetry, start, 10, ApiEventKind::Event);
        observe(
            &mut telemetry,
            start,
            20,
            ApiEventKind::Content("partial".into()),
        );
        observe(
            &mut telemetry,
            start,
            30,
            ApiEventKind::Usage(json!({"prompt_tokens":20})),
        );
        telemetry.finish(start + Duration::from_millis(terminal_ms), false);
        let metrics = telemetry.metrics();
        assert_eq!(metrics.total_duration_ms, Some(terminal_ms as f64));
        assert_eq!(metrics.generation_duration_ms, Some(0.0));
        assert_eq!(metrics.generation_throughput, None);
        assert_eq!(metrics.total_tokens, None);
        assert_eq!(metrics.output_tokens, None);
        assert_eq!(metrics.context_usage_percent, Some(2.0));
        assert_eq!(metrics.remaining_context, Some(980));
    }
}

#[test]
fn absent_usage_and_unstarted_requests_keep_unavailable_values() {
    let start = Instant::now();
    let mut unstarted = GenerationTelemetry::new("credentials-failed".into(), Some(100));
    unstarted.finish(start, false);
    assert_eq!(unstarted.metrics().request_latency_ms, None);
    assert_eq!(unstarted.metrics().total_duration_ms, None);
    assert_eq!(unstarted.metrics().context_window, Some(100));
    assert_eq!(unstarted.metrics().usage_source, "unavailable");
    let mut telemetry = GenerationTelemetry::new("no-usage".into(), None);
    telemetry.start(start);
    observe(
        &mut telemetry,
        start,
        10,
        ApiEventKind::Content("日本語 \n".into()),
    );
    observe(
        &mut telemetry,
        start,
        110,
        ApiEventKind::Content("more".into()),
    );
    observe(&mut telemetry, start, 120, ApiEventKind::Event);
    telemetry.finish(start + Duration::from_secs(1), true);
    assert_eq!(telemetry.metrics().generation_duration_ms, Some(100.0));
    assert_eq!(telemetry.metrics().generation_throughput, None);
    assert_eq!(telemetry.metrics().input_tokens, None);
    assert_eq!(telemetry.metrics().output_tokens, None);
    assert_eq!(telemetry.metrics().context_usage_percent, None);
    assert_eq!(telemetry.metrics().remaining_context, None);
    assert_eq!(telemetry.metrics().usage_source, "unavailable");
}

#[test]
fn null_empty_and_unknown_usage_do_not_invent_counts() {
    for usage in [
        json!({}),
        json!({"unrecognized":123}),
        json!({
            "prompt_tokens":null,"completion_tokens":null,"total_tokens":null,
            "prompt_tokens_details":{"cached_tokens":null},"completion_tokens_details":null
        }),
    ] {
        let mut telemetry = GenerationTelemetry::new("attempt".into(), None);
        observe(
            &mut telemetry,
            Instant::now(),
            0,
            ApiEventKind::Usage(usage),
        );
        let metrics = telemetry.metrics();
        assert_eq!(metrics.input_tokens, None);
        assert_eq!(metrics.output_tokens, None);
        assert_eq!(metrics.total_tokens, None);
        assert_eq!(metrics.cached_tokens, None);
        assert_eq!(metrics.reasoning_tokens, None);
        assert_eq!(metrics.usage_source, "unavailable");
    }
}

#[test]
fn zero_and_detailed_only_usage_are_real_api_reports() {
    let start = Instant::now();
    let mut telemetry = GenerationTelemetry::new("attempt".into(), Some(100));
    telemetry.start(start);
    observe(
        &mut telemetry,
        start,
        1,
        ApiEventKind::Usage(json!({"completion_tokens_details":{"reasoning_tokens":0}})),
    );
    assert_eq!(telemetry.metrics().reasoning_tokens, Some(0));
    assert_eq!(telemetry.metrics().input_tokens, None);
    assert_eq!(telemetry.metrics().usage_source, "api");
    observe(
        &mut telemetry,
        start,
        2,
        ApiEventKind::Usage(json!({"prompt_tokens":0,"completion_tokens":0})),
    );
    assert_eq!(telemetry.metrics().total_tokens, Some(0));
    assert_eq!(telemetry.metrics().context_usage_percent, Some(0.0));
    assert_eq!(telemetry.metrics().remaining_context, Some(100));
    assert_eq!(telemetry.metrics().generation_throughput, None);
    observe(&mut telemetry, start, 3, ApiEventKind::Content(" ".into()));
    assert_eq!(telemetry.metrics().ttft_ms, Some(3.0));
    assert_eq!(telemetry.metrics().generation_duration_ms, Some(0.0));
    assert_eq!(telemetry.metrics().generation_throughput, None);
    observe(
        &mut telemetry,
        start,
        3,
        ApiEventKind::Content("same network observation".into()),
    );
    assert_eq!(telemetry.metrics().generation_throughput, None);
}

#[test]
fn usage_rejects_invalid_counts_details_and_unsafe_derived_total_atomically() {
    let invalid: Vec<Value> = vec![
        json!(null),
        json!([]),
        json!({"prompt_tokens":-1}),
        json!({"completion_tokens":1.0}),
        json!({"total_tokens":"3"}),
        json!({"prompt_tokens":true}),
        json!({"prompt_tokens":MAX_SAFE_INTEGER + 1}),
        json!({"total_tokens":u64::MAX}),
        json!({"prompt_tokens":MAX_SAFE_INTEGER,"completion_tokens":1}),
        json!({"prompt_tokens_details":[]}),
        json!({"completion_tokens_details":4}),
        json!({"prompt_tokens_details":{"cached_tokens":-1}}),
        json!({"prompt_tokens_details":{"cached_tokens":MAX_SAFE_INTEGER + 1}}),
        json!({"completion_tokens_details":{"reasoning_tokens":"2"}}),
        json!({"completion_tokens_details":{"reasoning_tokens":MAX_SAFE_INTEGER + 1}}),
        json!({"prompt_tokens":8,"completion_tokens_details":{"reasoning_tokens":false}}),
    ];
    for usage in invalid {
        let mut telemetry = GenerationTelemetry::new("attempt".into(), Some(100));
        let error = telemetry
            .observe(&ApiEvent {
                at: Instant::now(),
                kind: ApiEventKind::Usage(usage.clone()),
            })
            .unwrap_err();
        assert_eq!(error.code, "format", "{usage}");
        assert_eq!(telemetry.metrics().usage_source, "unavailable");
        assert_eq!(telemetry.metrics().input_tokens, None);
    }
}

#[test]
fn later_usage_updates_derived_totals_without_erasing_reports_with_nulls() {
    let start = Instant::now();
    let mut telemetry = GenerationTelemetry::new("attempt".into(), None);
    observe(
        &mut telemetry,
        start,
        1,
        ApiEventKind::Usage(json!({"prompt_tokens":10,"completion_tokens":2})),
    );
    assert_eq!(telemetry.metrics().total_tokens, Some(12));
    observe(
        &mut telemetry,
        start,
        2,
        ApiEventKind::Usage(json!({"completion_tokens":4})),
    );
    assert_eq!(telemetry.metrics().total_tokens, Some(14));
    observe(
        &mut telemetry,
        start,
        3,
        ApiEventKind::Usage(json!({"total_tokens":20})),
    );
    observe(
        &mut telemetry,
        start,
        4,
        ApiEventKind::Usage(json!({"completion_tokens":null,"prompt_tokens_details":null})),
    );
    assert_eq!(telemetry.metrics().total_tokens, Some(20));
    assert_eq!(telemetry.metrics().output_tokens, Some(4));
    assert_eq!(telemetry.metrics().context_usage_percent, None);
    assert_eq!(telemetry.metrics().remaining_context, None);
    for context in [None, Some(0), Some(-1), Some(i64::MAX)] {
        assert_eq!(
            GenerationTelemetry::new("attempt".into(), context)
                .metrics()
                .context_window,
            None
        );
    }
}
