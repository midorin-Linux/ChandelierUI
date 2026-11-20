import type { SessionDefaults } from "../types/chat.ts"
import type { SessionData } from "../types/session.ts"

/** A new session's data: the default model wins, otherwise `model` is kept. */
export function emptyData(
  model: string,
  defaults: SessionDefaults
): SessionData {
  return {
    model: defaults.model || model,
    reasoning_effort: defaults.effort,
    system_prompt: defaults.systemPrompt,
    messages: [],
    branches: { main: null },
    current_branch: "main",
  }
}
