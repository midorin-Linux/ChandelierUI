# Inference measurements

All elapsed times are client-observed, measured in Rust with `std::time::Instant`. Epoch timestamps record persistence history only; they are not subtracted to measure latency. Milliseconds are stored as floating-point values.

| Field                  | Definition                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| Request latency        | Request start → HTTP response headers, including unsuccessful statuses                             |
| Time to first event    | Request start → first complete nonempty SSE data event, including role-only events                 |
| TTFT                   | Request start → first nonempty text `delta.content` (client-observed time to first content)        |
| Generation duration    | First nonempty content → last nonempty content                                                     |
| Total request duration | Request start → observed terminal outcome                                                          |
| Generation throughput  | API-reported completion tokens / generation-duration seconds, only with a positive measurable span |
| Output TPS             | Unavailable without an exact tokenizer/count of visible output tokens                              |
| Input context usage    | API input tokens / configured model context window × 100                                           |
| Remaining context      | max(context window − input tokens, 0); not a prediction of usable output budget                    |

Request start is the call into the Rust HTTP adapter after credential lookup/preflight, not a packet-level wire timestamp. TTFT includes client/request construction, HTTP/network latency, provider queueing and server processing. It is **not** the model's internal prefill time. First event and first content are separate: a role-only event does not establish TTFT. Empty text does not establish TTFT; nonempty whitespace is text.

The generation span ends at the last content, not a later usage-only event or `[DONE]`. A single instantaneous content observation can have a zero span; rates then remain unavailable. Total duration still includes the complete stream lifecycle.

An SSE event is observed when the final network chunk needed to frame it is received. Events completed within the same received chunk share its observation timestamp. Channel backpressure and SQLite checkpointing must not be mistaken for additional token-generation time.

## Tokens and provenance

Tokens are never inferred from characters, SSE frames or event counts. Reported input/output/total/cached-input/reasoning counts are retained per attempt. Cached tokens are part of the input count, not subtracted from context usage. Missing counts remain null. The initial implementation does not estimate token counts; provenance is `api` or `unavailable` (`estimated` is reserved for a future explicitly identified estimator).

Counts and manually configured context windows must fit JavaScript's exact integer range (0–9,007,199,254,740,991; context windows must be positive). Larger or invalid usage counts are rejected rather than silently rounded in the UI.

Completion counts may include hidden reasoning or other non-visible output. The UI therefore labels their rate **API-reported generation throughput**, not visible-text TPS. Exact visible-only Output TPS remains unavailable.

Unknown context length remains null/unconfigured. No model-name heuristic fills it. Context usage describes the **latest request's input**, not a continuously tokenized live composer. Context percent can exceed 100 if the provider's report and configured context disagree; it must not be silently clamped into a plausible measurement.

## Failures and reproducibility

Cancellation, timeout and disconnect retain received text and any observed metrics. A stream EOF without `[DONE]` is a failure, not a successful answer. Missing usage is not a failure: timings remain useful. Metrics are linked to generation ID, so regeneration does not overwrite previous measurements. Crash recovery retains persisted measurements but does not fabricate elapsed durations across a process restart.

Analytics is computed in the core crate and stored in SQLite; React formats already-computed results. Replacing the panel must not change these definitions. A provider/model/request configuration snapshot is retained beside each attempt for interpreting historical results.
