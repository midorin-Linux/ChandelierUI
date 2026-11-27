import type { ApiModel, ProviderPreset } from "../types/chat.ts"

/** The last list fetched for one provider; it belongs to that provider's `baseUrl`. */
export interface ProviderModels {
  baseUrl: string
  models: ApiModel[]
  isLoading: boolean
  error: string | null
}

/** Fetched lists keyed by provider id. Every preset with a URL gets one. */
export type ModelLists = Record<string, ProviderModels>

type PresetRef = Pick<ProviderPreset, "id" | "baseUrl">

/** True when `preset` has a URL but no list fetched for it yet (or only for an older URL). */
export function needsLoad(lists: ModelLists, preset: PresetRef) {
  const url = preset.baseUrl.trim()
  return url !== "" && lists[preset.id]?.baseUrl !== url
}

/** What the UI shows for one provider's list. */
export function providerModelsView(
  lists: ModelLists,
  preset: PresetRef | null
) {
  const url = preset?.baseUrl.trim() ?? ""
  const entry = preset ? lists[preset.id] : undefined
  const current = entry !== undefined && entry.baseUrl === url
  const models = url && current ? entry.models : []
  // A list not fetched yet is about to be: `loadMissingModels` runs on every preset change.
  const loading = url !== "" && (!current || entry.isLoading)
  const error = url && current ? entry.error : null
  const status = !url
    ? "Enter a base URL to load models."
    : loading
      ? "Loading models…"
      : error
        ? error
        : models.length === 0
          ? "The provider returned no models."
          : `${models.length} models`
  return { models, loading, error, status }
}

export type ProviderModelsView = ReturnType<typeof providerModelsView>

/**
 * What the UI shows for the session's provider. `preferredModel` (the session's saved model)
 * is selected once the list contains it, otherwise the first model.
 */
export function modelsView(
  lists: ModelLists,
  preset: PresetRef | null,
  preferredModel: string
) {
  const view = providerModelsView(lists, preset)
  const selectedModel = view.models.some((model) => model.id === preferredModel)
    ? preferredModel
    : (view.models[0]?.id ?? "")
  const modelsStatus = !preset
    ? "Add a provider in Settings to load models."
    : view.status
  return {
    models: view.models,
    modelsLoading: view.loading,
    selectedModel,
    modelsStatus,
  }
}

/** Search words, lowercased; every one must match. */
export const searchTerms = (query: string) =>
  query.toLowerCase().split(/\s+/).filter(Boolean)

/**
 * Models matching every term in the model id or `context` (e.g. the provider name),
 * so "openrouter gpt" narrows to one provider's GPT models.
 */
export function filterModels(
  models: readonly ApiModel[],
  terms: readonly string[],
  context = ""
) {
  if (terms.length === 0) return models
  const prefix = context.toLowerCase()
  return models.filter((model) => {
    const text = `${prefix} ${model.id.toLowerCase()}`
    return terms.every((term) => text.includes(term))
  })
}
