import type { ApiModel } from "../types/chat.ts"

/** The last model list fetched; it belongs to one `(providerUrl, providerId)` pair. */
export interface ModelList {
  providerUrl: string
  providerId: string | null
  models: ApiModel[]
  isLoading: boolean
  error: string | null
}

export const emptyModelList: ModelList = {
  providerUrl: "",
  providerId: null,
  models: [],
  isLoading: false,
  error: null,
}

/**
 * What the UI shows for the current provider. `preferredModel` (the session's saved model)
 * is selected once the list contains it, otherwise the first model.
 */
export function modelsView(
  list: ModelList,
  providerUrl: string,
  providerId: string | null,
  preferredModel: string
) {
  // Two presets may share a URL but not a key, so the list belongs to the pair.
  const current =
    list.providerUrl === providerUrl && list.providerId === providerId
  const models = current ? list.models : []
  const modelsLoading = current ? list.isLoading : Boolean(providerUrl.trim())
  const selectedModel = models.some((model) => model.id === preferredModel)
    ? preferredModel
    : (models[0]?.id ?? "")
  const modelsStatus =
    current && list.error
      ? list.error
      : modelsLoading
        ? "Loading models…"
        : !providerUrl.trim()
          ? "Enter a provider URL and press Enter or click Refresh to load models."
          : models.length === 0
            ? "The provider returned no models."
            : `${models.length} models loaded.`
  return { models, modelsLoading, selectedModel, modelsStatus }
}
