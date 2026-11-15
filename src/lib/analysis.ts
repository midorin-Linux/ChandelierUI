import type { CompletionAttempt } from "../types/analysis"

export function formatMetric(value: number | null, unit = "", digits = 2): string {
  if (value === null || !Number.isFinite(value)) return "Unavailable"
  return `${value.toLocaleString(undefined, { maximumFractionDigits: digits })}${unit ? ` ${unit}` : ""}`
}

export function contextUtilization(inputTokens: number | null, contextLength: number | null): number | null {
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
    const { error, metrics } = attempt.result
    if (error !== null || metrics.timed_out || (metrics.http_status !== null && metrics.http_status >= 400)) errors++
    if (metrics.timed_out) timeouts++
    if (attempt.retry) retries++
    if (metrics.http_status === 429) rateLimited++
    if (metrics.http_status !== null && metrics.http_status >= 500 && metrics.http_status < 600) serverErrors++
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
    const local = hostname === "localhost" || hostname.endsWith(".localhost") ||
      /^127\./.test(hostname) || hostname === "[::1]" || hostname === "::1"
    return {
      provider: url.host,
      classification: local ? "Local (loopback)" : "External",
      endpoint: `${url.pathname.replace(/\/+$/, "")}/chat/completions`,
    }
  } catch {
    return { provider: "Unavailable", classification: "Unavailable", endpoint: "Unavailable" }
  }
}
