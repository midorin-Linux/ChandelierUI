import assert from "node:assert/strict"
import { test } from "node:test"
import { emptyData, noChoice } from "./sessionDefaults.ts"

const defaults = {
  providerId: "preset-1",
  effort: "high",
  model: "",
  systemPrompt: "Be brief.",
} as const
const current = { providerId: "preset-2", model: "current" }

test("without a default model, the current model and its provider are kept", () => {
  const data = emptyData(current, defaults)
  assert(data.model === "current", "An empty default model keeps the model")
  assert(
    data.provider_id === "preset-2",
    "The kept model stays with the provider it came from"
  )
})

test("a default model comes with its own provider", () => {
  const data = emptyData(current, { ...defaults, model: "preferred" })
  assert(data.model === "preferred", "A default model wins")
  assert(
    data.provider_id === "preset-1",
    "The default model's provider wins over the current one"
  )
})

test("with nothing chosen yet, the default provider is used", () => {
  const data = emptyData(noChoice, defaults)
  assert(data.model === "", "No model until the list is loaded")
  assert(data.provider_id === "preset-1", "Falls back to the default provider")
})

test("a new session takes the defaults and starts empty", () => {
  const data = emptyData(current, defaults)
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
})
