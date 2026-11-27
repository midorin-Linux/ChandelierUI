import type { SessionDefaults } from "../types/chat.ts"
import type { SessionData } from "../types/session.ts"

/** The model a chat is using, and the provider it comes from. */
export interface ModelChoice {
  providerId: string | null
  model: string
}

/**
 * A new session's data. A default model comes with its provider; without one,
 * the `current` chat's model and provider are kept.
 */
export function emptyData(
  current: ModelChoice,
  defaults: SessionDefaults
): SessionData {
  const keep = defaults.model === ""
  return {
    model: keep ? current.model : defaults.model,
    reasoning_effort: defaults.effort,
    system_prompt: defaults.systemPrompt,
    provider_id: keep
      ? (current.providerId ?? defaults.providerId)
      : defaults.providerId,
    messages: [],
    branches: { main: null },
    current_branch: "main",
  }
}

/** Nothing chosen yet: a new session then starts from the defaults alone. */
export const noChoice: ModelChoice = { providerId: null, model: "" }
