import type {
  AttemptRequest,
  CompletionAttempt,
  CompletionMetrics,
} from "../types/analysis"
import type { ProviderChatRequest } from "../types/chat"

/** Field by field, so message contents and anything secret can never be stored. */
export function toAttemptRequest(
  payload: ProviderChatRequest,
  systemPrompt: string,
  headMessageId: string
): AttemptRequest {
  return {
    base_url: payload.provider.base_url,
    model: payload.request.model,
    reasoning_effort: payload.request.reasoning_effort,
    system_prompt: systemPrompt,
    head_message_id: headMessageId,
  }
}

export function emptyMetrics(e2eMs: number): CompletionMetrics {
  return {
    ttft_ms: null,
    ttfb_ms: null,
    e2e_ms: e2eMs,
    decode_ms: null,
    prefill_ms: null,
    server_decode_ms: null,
    connection_ms: null,
    dns_ms: null,
    tcp_ms: null,
    tls_ms: null,
    output_tps: null,
    tpot_ms: null,
    itl_mean_ms: null,
    itl_max_ms: null,
    itl_stddev_ms: null,
    chunk_interval_mean_ms: null,
    chunk_interval_max_ms: null,
    chunk_interval_stddev_ms: null,
    input_tokens: null,
    output_tokens: null,
    total_tokens: null,
    cached_tokens: null,
    reasoning_tokens: null,
    http_status: null,
    finish_reason: null,
    timed_out: false,
  }
}

export function isFailed({
  result: { error, metrics },
}: CompletionAttempt): boolean {
  return (
    error !== null ||
    metrics.timed_out ||
    (metrics.http_status !== null && metrics.http_status >= 400)
  )
}

export function formatMetric(
  value: number | null,
  unit = "",
  digits = 2
): string {
  if (value === null || !Number.isFinite(value)) return "Unavailable"
  return `${value.toLocaleString(undefined, { maximumFractionDigits: digits })}${unit ? ` ${unit}` : ""}`
}

export function contextUtilization(
  inputTokens: number | null,
  contextLength: number | null
): number | null {
  return inputTokens !== null && contextLength !== null && contextLength > 0
    ? (inputTokens / contextLength) * 100
    : null
}

export function summarizeAttempts(attempts: readonly CompletionAttempt[]) {
  let errors = 0
  let timeouts = 0
  let retries = 0
  let rateLimited = 0
  let serverErrors = 0
  for (const attempt of attempts) {
    const { metrics } = attempt.result
    if (isFailed(attempt)) errors++
    if (metrics.timed_out) timeouts++
    if (attempt.retry) retries++
    if (metrics.http_status === 429) rateLimited++
    if (
      metrics.http_status !== null &&
      metrics.http_status >= 500 &&
      metrics.http_status < 600
    )
      serverErrors++
  }
  return {
    count: attempts.length,
    errors,
    timeouts,
    retries,
    rateLimited,
    serverErrors,
    errorRate: attempts.length ? (errors / attempts.length) * 100 : null,
    timeoutRate: attempts.length ? (timeouts / attempts.length) * 100 : null,
  }
}

export function providerLocation(baseUrl: string) {
  try {
    const url = new URL(baseUrl.trim())
    const hostname = url.hostname.toLowerCase()
    const local =
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      /^127\./.test(hostname) ||
      hostname === "[::1]" ||
      hostname === "::1"
    return {
      provider: url.host,
      classification: local ? "Local (loopback)" : "External",
      endpoint: `${url.pathname.replace(/\/+$/, "")}/chat/completions`,
    }
  } catch {
    return {
      provider: "Unavailable",
      classification: "Unavailable",
      endpoint: "Unavailable",
    }
  }
}
