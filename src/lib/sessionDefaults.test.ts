import assert from "node:assert/strict"
import { test } from "node:test"
import { emptyData } from "./sessionDefaults.ts"

const defaults = {
  providerId: "preset-1",
  effort: "high",
  model: "",
  systemPrompt: "Be brief.",
} as const

test("the default model applies only when set", () => {
  assert(
    emptyData("current", defaults).model === "current",
    "An empty default model keeps the current model"
  )
  assert(
    emptyData("current", { ...defaults, model: "preferred" }).model ===
      "preferred",
    "A default model wins over the current model"
  )
})

test("a new session takes the defaults and starts empty", () => {
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
})
