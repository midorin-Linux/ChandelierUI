export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export type NumericParameter =
  | "temperature"
  | "top_p"
  | "max_completion_tokens"
  | "frequency_penalty"
  | "presence_penalty"
export type GenerationParameter = "system_prompt" | NumericParameter
export type GenerationParameters = {
  system_prompt?: string | null
  temperature?: number | null
  top_p?: number | null
  max_completion_tokens?: number | null
  frequency_penalty?: number | null
  presence_penalty?: number | null
}
export type ModelCapabilities = {
  unsupported_parameters?: NumericParameter[]
  max_tokens_parameter?: "max_tokens" | "max_completion_tokens"
}
export interface AppPreferences {
  theme: "system" | "light" | "dark"
  chat_width: number
  font_size: number
  auto_scroll: boolean
  log_level: "off" | "error" | "warn" | "info" | "debug" | "trace"
  generation: GenerationParameters
  last_model_id: string | null
}

export interface Session {
  id: string
  title: string
  created_at: number
  updated_at: number
  selected_model_id: string | null
  session_settings: GenerationParameters
}

export interface Message {
  id: string
  session_id: string
  role: string
  content: string
  status: string
  created_at: number
  updated_at: number
  ordinal: number
  active: boolean
}

export interface Generation {
  id: string
  message_id: string
  provider_id: string
  model_id: string
  status: string
  request_parameters: JsonValue
  request_snapshot: JsonValue
  started_at: number
  finished_at: number | null
  finish_reason: string | null
  error: AppError | null
}

export interface GenerationMetrics {
  generation_id: string
  request_latency_ms: number | null
  first_event_ms: number | null
  ttft_ms: number | null
  generation_duration_ms: number | null
  total_duration_ms: number | null
  input_tokens: number | null
  output_tokens: number | null
  total_tokens: number | null
  cached_tokens: number | null
  reasoning_tokens: number | null
  context_window: number | null
  output_tps: number | null
  generation_throughput: number | null
  context_usage_percent: number | null
  remaining_context: number | null
  usage_source: string
}

export interface Provider {
  id: string
  name: string
  base_url: string
  authentication_mode: string
  credential_reference: string | null
  timeout_seconds: number
  supports_usage: boolean
  default_parameters: GenerationParameters
  created_at: number
}

export interface Model {
  id: string
  provider_id: string
  model_identifier: string
  display_name: string
  context_window: number | null
  capabilities: ModelCapabilities
  default_parameters: GenerationParameters
}

export interface SessionDetail {
  session: Session
  messages: Message[]
  generations: Generation[]
  metrics: GenerationMetrics[]
}

export interface Bootstrap {
  sessions: Session[]
  providers: Provider[]
  models: Model[]
  settings: AppPreferences
  data_directory: string
}

export interface AppError {
  code: string
  message: string
}

export interface GenerateInput {
  session_id: string
  action: "send" | "regenerate" | "edit"
  content: string | null
  message_id: string | null
  parameters: JsonValue
}

export interface StreamEvent {
  generation_id: string
  session_id: string
  sequence: number
  kind: "started" | "delta" | "usage" | "completed" | "cancelled" | "error"
  message_id: string | null
  delta: string | null
  metrics: GenerationMetrics | null
  error: AppError | null
}
