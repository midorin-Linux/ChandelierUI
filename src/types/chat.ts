export type Effort = "off" | "low" | "medium" | "high" | "xhigh" | "max"

export interface ApiModel {
  id: string
  context_length?: number | null
}

export interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export interface ChatCompletionRequest {
  model: string
  messages: ChatMessage[]
  // The backend maps off to none and max to xhigh on the OpenAI wire.
  reasoning_effort: Effort
}

export interface ProviderChatRequest {
  provider: { base_url: string }
  request: ChatCompletionRequest
}
