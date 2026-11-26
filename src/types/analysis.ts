import type { ChatMessage, Effort } from "./chat"
import type { ErrorKind } from "./error"

export interface CompletionMetrics {
  ttft_ms: number | null
  ttfb_ms: number | null
  e2e_ms: number
  decode_ms: number | null
  prefill_ms: number | null
  server_decode_ms: number | null
  connection_ms: number | null
  dns_ms: number | null
  tcp_ms: number | null
  tls_ms: number | null
  output_tps: number | null
  tpot_ms: number | null
  itl_mean_ms: number | null
  itl_max_ms: number | null
  itl_stddev_ms: number | null
  chunk_interval_mean_ms: number | null
  chunk_interval_max_ms: number | null
  chunk_interval_stddev_ms: number | null
  input_tokens: number | null
  output_tokens: number | null
  total_tokens: number | null
  cached_tokens: number | null
  reasoning_tokens: number | null
  http_status: number | null
  finish_reason: string | null
  timed_out: boolean
}

export interface MeasuredCompletion {
  message: ChatMessage | null
  error: string | null
  /** Set exactly when `error` is; null when the request failed outside the backend. */
  error_kind: ErrorKind | null
  metrics: CompletionMetrics
}

/**
 * What is stored of a completion: the reply itself lives in the session tree.
 * Attempts stored before `error_kind` existed lack it.
 */
export type StoredCompletionResult = Omit<
  MeasuredCompletion,
  "message" | "error_kind"
> & { error_kind?: ErrorKind | null }

/** The request sent = system_prompt + pathToRoot(head_message_id). */
export interface AttemptRequest {
  base_url: string
  model: string
  reasoning_effort: Effort
  system_prompt: string
  head_message_id: string // the user message the request ended with
}

export interface CompletionAttempt {
  version: 1
  id: number
  started_at: string
  retry: boolean
  concurrency: number
  request: AttemptRequest
  context_length: number | null
  result: StoredCompletionResult
}
