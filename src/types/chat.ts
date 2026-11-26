import type { ChatPayload_Deserialize, ReasoningEffort } from "../bindings"

export type {
  CompletionDelta,
  Message_Serialize as ChatMessage,
  Model_Serialize as ApiModel,
} from "../bindings"

export type Effort = ReasoningEffort
// A `Record` must list every `ReasoningEffort`, so a missing or unknown one fails to compile.
const effortSet = {
  off: true,
  low: true,
  medium: true,
  high: true,
  xhigh: true,
  max: true,
} satisfies Record<Effort, true>
export const efforts = Object.keys(effortSet) as Effort[]

/** Applied to new sessions; an empty model keeps the current one. */
export interface SessionDefaults {
  /** `provider.active_id`: the preset a new chat starts with. */
  providerId: string | null
  effort: Effort
  model: string
  systemPrompt: string
}

/**
 * The frontend always sends `base_url` (it is stored with each attempt).
 * The API key never leaves the backend; it is loaded from the keyring by `id`.
 */
export type ProviderChatRequest = ChatPayload_Deserialize & {
  provider: { base_url: string }
}

export interface ProviderPreset {
  id: string
  name: string
  baseUrl: string
}
