import assert from "node:assert/strict"
import { test } from "node:test"
import {
  filterModels,
  modelsView,
  needsLoad,
  providerModelsView,
  searchTerms,
  type ModelLists,
} from "./models.ts"

const preset = { id: "a", baseUrl: "http://a/v1" }
const loaded = (models: string[], baseUrl = preset.baseUrl): ModelLists => ({
  a: {
    baseUrl,
    models: models.map((id) => ({ id })) as ModelLists[string]["models"],
    isLoading: false,
    error: null,
  },
})

test("a preset needs loading until a list exists for its current URL", () => {
  assert(needsLoad({}, preset), "Nothing fetched yet")
  assert(!needsLoad(loaded([]), preset), "Fetched for this URL")
  assert(
    needsLoad(loaded([], "http://old/v1"), preset),
    "A list for an older URL is stale"
  )
  assert(!needsLoad({}, { id: "a", baseUrl: "  " }), "No URL, nothing to load")
})

test("a list for another URL is never shown", () => {
  const view = providerModelsView(loaded(["m"], "http://old/v1"), preset)
  assert(view.models.length === 0, "Stale models are hidden")
  assert(view.loading, "It is about to be reloaded")
})

test("the view reports errors and empty URLs", () => {
  const failed: ModelLists = {
    a: { ...loaded([]).a, error: "connection refused" },
  }
  assert(providerModelsView(failed, preset).status === "connection refused")
  const empty = providerModelsView({}, { id: "a", baseUrl: "" })
  assert(!empty.loading && empty.models.length === 0, "No URL, no loading")
})

test("the session's model is selected once its provider lists it", () => {
  const lists = loaded(["x", "y"])
  assert(modelsView(lists, preset, "y").selectedModel === "y")
  assert(
    modelsView(lists, preset, "gone").selectedModel === "x",
    "Falls back to the first model"
  )
  assert(modelsView(lists, null, "y").selectedModel === "", "No provider")
})

test("every search term must match the model id or its context", () => {
  const models = [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }, { id: "llama-3" }]
  const ids = (query: string, context?: string) =>
    filterModels(models as never, searchTerms(query), context).map((m) => m.id)
  assert.deepEqual(ids(""), ["gpt-4o", "gpt-4o-mini", "llama-3"])
  assert.deepEqual(ids("GPT mini"), ["gpt-4o-mini"])
  assert.deepEqual(ids("openrouter llama", "OpenRouter"), ["llama-3"])
  assert.deepEqual(ids("openrouter llama", "Local"), [])
})
