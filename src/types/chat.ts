export const efforts = ["off", "low", "medium", "high", "xhigh", "max"] as const
export type Effort = (typeof efforts)[number]

export interface ApiModel {
  id: string
  context_length?: number | null
}

export interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
  reasoning?: string
}

export interface CompletionDelta {
  content: string
  reasoning: string
}

export interface ChatCompletionRequest {
  model: string
  messages: Pick<ChatMessage, "role" | "content">[]
  // The backend maps off to none and max to xhigh on the OpenAI wire.
  reasoning_effort: Effort
}

export interface ProviderChatRequest {
  provider: { base_url: string }
  request: ChatCompletionRequest
}
