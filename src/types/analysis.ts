import type { ChatMessage, ProviderChatRequest } from "./chat"

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
  metrics: CompletionMetrics
}

export interface CompletionAttempt {
  id: number
  started_at: string
  retry: boolean
  concurrency: number
  payload: ProviderChatRequest
  context_length: number | null
  result: MeasuredCompletion
}
