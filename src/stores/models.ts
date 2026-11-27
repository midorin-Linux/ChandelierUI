import { create } from "zustand"
import { listModels } from "@/src/lib/api"
import { needsLoad, type ModelLists } from "@/src/lib/models"
import { errorMessage } from "@/src/lib/utils"
import type { ProviderPreset } from "@/src/types/chat"

/** Every provider's fetched model list; see `providerModelsView` for what the UI derives. */
export const useModelsStore = create<ModelLists>(() => ({}))

/** Per provider: a newer request makes older responses stale. */
const latest = new Map<string, number>()

/** (Re)fetches one provider's list. */
export async function loadModels(preset: ProviderPreset) {
  const request = (latest.get(preset.id) ?? 0) + 1
  latest.set(preset.id, request)
  const baseUrl = preset.baseUrl.trim()
  const set = (patch: Partial<ModelLists[string]>) => {
    if (latest.get(preset.id) !== request) return
    useModelsStore.setState((lists) => ({
      [preset.id]: { ...lists[preset.id], ...patch } as ModelLists[string],
    }))
  }
  set({ baseUrl, models: [], isLoading: baseUrl !== "", error: null })
  if (!baseUrl) return
  try {
    const models = await listModels({ base_url: baseUrl, id: preset.id })
    set({ models, isLoading: false })
  } catch (cause) {
    set({ isLoading: false, error: errorMessage(cause) })
  }
}

/** Fetches every provider whose list is missing or was fetched for another URL. */
export function loadMissingModels(presets: readonly ProviderPreset[]) {
  const lists = useModelsStore.getState()
  for (const preset of presets)
    if (needsLoad(lists, preset)) void loadModels(preset)
}

/** Drops a deleted provider's list; a late response for it is ignored. */
export function forgetModels(id: string) {
  latest.set(id, (latest.get(id) ?? 0) + 1)
  useModelsStore.setState((lists) => {
    const next = { ...lists }
    delete next[id]
    return next
  }, true)
}
