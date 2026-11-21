import { emptyData } from "./sessionDefaults.ts"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

const defaults = {
  providerId: "preset-1",
  effort: "high",
  model: "",
  systemPrompt: "Be brief.",
} as const

assert(
  emptyData("current", defaults).model === "current",
  "An empty default model keeps the current model"
)
assert(
  emptyData("current", { ...defaults, model: "preferred" }).model ===
    "preferred",
  "A default model wins over the current model"
)

const data = emptyData("m", defaults)
assert(data.reasoning_effort === "high", "Effort comes from the defaults")
assert(
  data.system_prompt === "Be brief.",
  "System prompt comes from the defaults"
)
assert(
  data.messages.length === 0 &&
    data.branches.main === null &&
    data.current_branch === "main",
  "A new session starts empty on main"
)
assert(
  data.provider_id === "preset-1",
  "A new session starts on the default provider (provider.active_id)"
)
