import {
  contextUtilization,
  emptyMetrics,
  formatMetric,
  providerLocation,
  redactPayload,
  summarizeAttempts,
} from "./analysis.ts"
import type { CompletionAttempt, CompletionMetrics } from "../types/analysis.ts"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

assert(formatMetric(null) === "Unavailable", "Null must remain unavailable")
assert(formatMetric(0) === "0", "Numeric zero must remain visible")
assert(formatMetric(0, "ms") === "0 ms", "Zero timing must retain its unit")
assert(
  formatMetric(Number.NaN) === "Unavailable",
  "Non-finite values must remain unavailable"
)
assert(
  contextUtilization(0, 100) === 0,
  "Zero input uses zero percent of a known context"
)
assert(
  contextUtilization(25, 100) === 25,
  "Context uses input divided by the known maximum"
)
assert(
  contextUtilization(25, null) === null,
  "Unknown context maximum must remain unavailable"
)
assert(
  contextUtilization(null, 100) === null,
  "Unknown input usage must remain unavailable"
)
assert(
  contextUtilization(25, 0) === null,
  "Zero context maximum must not divide by zero"
)

const metrics: CompletionMetrics = {
  ...emptyMetrics(0),
  input_tokens: 0,
  output_tokens: 0,
  total_tokens: 0,
  http_status: 200,
  finish_reason: "stop",
}
function attempt(
  id: number,
  status: number | null,
  error: string | null,
  timedOut = false,
  retry = false
): CompletionAttempt {
  return {
    id,
    started_at: "2026-11-15T00:00:00.000Z",
    retry,
    concurrency: 1,
    context_length: null,
    payload: {
      provider: { base_url: "http://localhost:8000/v1" },
      request: { model: "test", reasoning_effort: "off", messages: [] },
    },
    result: {
      message: null,
      error,
      metrics: { ...metrics, http_status: status, timed_out: timedOut },
    },
  }
}
const empty = summarizeAttempts([])
assert(
  empty.count === 0 && empty.errors === 0 && empty.retries === 0,
  "Empty history has zero observed counts"
)
assert(
  empty.errorRate === null && empty.timeoutRate === null,
  "Empty history has no measurable rates"
)
const summary = summarizeAttempts([
  attempt(1, 200, null),
  attempt(2, 429, "Rate limited"),
  attempt(3, 503, null, false, true),
  attempt(4, null, "Timed out", true, true),
])
assert(
  summary.count === 4 && summary.errors === 3,
  "HTTP and network failures count once per attempt"
)
assert(
  summary.errorRate === 75 && summary.timeoutRate === 25,
  "Rates include all completed attempts"
)
assert(
  summary.timeouts === 1 && summary.retries === 2,
  "Timeout and explicit retry counts are independent"
)
assert(
  summary.rateLimited === 1 && summary.serverErrors === 1,
  "429 and 5xx statuses have separate counts"
)
assert(
  summarizeAttempts([attempt(1, null, null, true)]).errors === 1,
  "A timeout is an error even without an error string"
)
assert(
  summarizeAttempts([attempt(1, 600, "Error")]).serverErrors === 0,
  "Only 500–599 count as 5xx"
)

for (const base of [
  "http://localhost:8000/v1/",
  "http://127.0.0.2/v1",
  "http://[::1]/v1",
  "http://model.localhost/v1",
]) {
  const location = providerLocation(base)
  assert(
    location.classification === "Local (loopback)",
    `Loopback should be local: ${base}`
  )
  assert(
    location.endpoint === "/v1/chat/completions",
    "Endpoint must retain the base path without double slashes"
  )
}
assert(
  providerLocation("https://api.example.com/v1").classification === "External",
  "Remote providers are external"
)
assert(
  providerLocation("http://localhost.example.com/v1").classification ===
    "External",
  "A hostname containing localhost is not loopback"
)
assert(
  providerLocation("not a URL").endpoint === "Unavailable",
  "Invalid URLs must not throw"
)
assert(
  providerLocation("https://api.example.com").endpoint === "/chat/completions",
  "Root bases have a valid endpoint path"
)

const withoutKey = {
  provider: { base_url: "https://api.example.com/v1" },
  request: { model: "test", reasoning_effort: "off" as const, messages: [] },
}
assert(
  redactPayload(withoutKey) === withoutKey,
  "Payloads without an API key are returned unchanged"
)
const withKey = {
  ...withoutKey,
  provider: { base_url: "https://api.example.com/v1", api_key: "sk-secret" },
}
const redacted = redactPayload(withKey)
assert(
  redacted.provider.api_key === "[REDACTED]" &&
    withKey.provider.api_key === "sk-secret",
  "API key must be redacted without mutating the source payload"
)
const blankKeyRedacted = redactPayload({
  ...withoutKey,
  provider: { base_url: "https://api.example.com/v1", api_key: "  " },
})
assert(
  !("api_key" in blankKeyRedacted.provider),
  "Blank API keys are omitted from preview"
)
