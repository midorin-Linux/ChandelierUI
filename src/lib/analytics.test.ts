import { formatMetric, selectAnalytics } from "./analytics.ts"
import type { LiveGeneration } from "../stores/chat"
import type {
  Generation,
  GenerationMetrics,
  SessionDetail,
} from "../types/domain"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

assert(
  formatMetric(null) !== formatMetric(0) &&
    formatMetric(undefined) !== formatMetric(0),
  "Missing measurements must not become zero"
)
assert(
  BigInt(formatMetric(Number.MAX_SAFE_INTEGER).replace(/[,\s]/g, "")) ===
    BigInt(Number.MAX_SAFE_INTEGER),
  "Safe token counts must not be abbreviated or rounded"
)

const original: Generation = {
  id: "original",
  message_id: "archived-message",
  provider_id: "provider",
  model_id: "model",
  status: "completed",
  request_parameters: {},
  request_snapshot: {},
  started_at: 1,
  finished_at: 2,
  finish_reason: "stop",
  error: null,
}
const current: Generation = {
  ...original,
  id: "current",
  message_id: "active-message",
  status: "streaming",
  started_at: 3,
  finished_at: null,
  finish_reason: null,
}
const originalMetrics: GenerationMetrics = {
  generation_id: original.id,
  request_latency_ms: null,
  first_event_ms: null,
  ttft_ms: null,
  generation_duration_ms: null,
  total_duration_ms: null,
  input_tokens: null,
  output_tokens: null,
  total_tokens: null,
  cached_tokens: null,
  reasoning_tokens: null,
  context_window: null,
  output_tps: null,
  generation_throughput: null,
  context_usage_percent: null,
  remaining_context: null,
  usage_source: "unavailable",
}
const persistedMetrics: GenerationMetrics = {
  ...originalMetrics,
  generation_id: current.id,
  ttft_ms: 20,
}
const liveMetrics: GenerationMetrics = { ...persistedMetrics, ttft_ms: 10 }
const detail: SessionDetail = {
  session: {
    id: "session",
    title: "Session",
    created_at: 1,
    updated_at: 3,
    selected_model_id: "model",
    session_settings: {},
  },
  messages: [
    {
      id: current.message_id,
      session_id: "session",
      role: "assistant",
      content: "saved current output",
      status: "streaming",
      created_at: 3,
      updated_at: 3,
      ordinal: 1,
      active: true,
    },
  ],
  generations: [original, current],
  metrics: [originalMetrics, persistedMetrics],
}
const live: LiveGeneration = {
  requestId: "request",
  generationId: current.id,
  messageId: current.message_id,
  sequence: 1,
  startedAt: 3,
  status: "streaming",
  content: "live current output",
  metrics: liveMetrics,
  cancelling: false,
}

const following = selectAnalytics(detail, live, null)
assert(
  following.selectedId === current.id && following.metrics?.ttft_ms === 10,
  "Latest selection must follow live metrics before final persistence"
)
assert(
  following.output === live.content,
  "Live output must not lag behind a persisted checkpoint"
)
const historical = selectAnalytics(detail, live, original.id)
assert(
  historical.selectedId === original.id && historical.metrics?.ttft_ms === null,
  "History selection must not be replaced by a different live attempt"
)
assert(
  historical.archived && historical.output === null,
  "Archived output must be fetched by generation ID, never borrowed from the current transcript"
)
assert(
  selectAnalytics(detail, live, "removed").selectedId === current.id,
  "A missing selection must fall back to the latest attempt"
)

const completed: SessionDetail = {
  ...detail,
  generations: [original, { ...current, status: "completed" }],
}
const terminal = selectAnalytics(
  completed,
  { ...live, status: "failed" },
  current.id
)
assert(
  terminal.metrics?.ttft_ms === 20 && terminal.status === "completed",
  "Persisted terminal state must supersede stale live state"
)
assert(
  terminal.attempts.find((attempt) => attempt.id === current.id)?.status ===
    "completed",
  "History labels must also prefer persisted terminal status"
)
assert(
  terminal.output === detail.messages[0].content,
  "Terminal output must come from the persisted attempt"
)
const pendingDetail: SessionDetail = {
  ...detail,
  generations: [original],
  messages: [],
  metrics: [originalMetrics],
}
const beforeRefresh = selectAnalytics(pendingDetail, live, null)
assert(
  beforeRefresh.selectedId === live.generationId &&
    beforeRefresh.generation === null,
  "A started channel must appear before session-detail refresh provides its immutable snapshot"
)
assert(
  beforeRefresh.metrics?.ttft_ms === 10 &&
    beforeRefresh.output === live.content,
  "Live measurements and output must survive a pending metadata refresh"
)
const restored = selectAnalytics(completed, null, original.id)
assert(
  restored.metrics?.generation_id === original.id && restored.output === null,
  "Restarted history must keep persisted metrics and request the actual archived message"
)
const tied: SessionDetail = {
  ...completed,
  generations: [
    original,
    { ...current, status: "completed", started_at: original.started_at },
  ],
}
assert(
  selectAnalytics(tied, null, null).selectedId === current.id,
  "Equal wall-clock timestamps must follow the active answer, not UUID ordering"
)
