import { create } from "zustand"
import { listModels } from "@/src/lib/api"
import { emptyModelList, type ModelList } from "@/src/lib/models"
import { errorMessage } from "@/src/lib/utils"

/** The fetched model list; see `modelsView` for what the UI derives from it. */
export const useModelsStore = create<ModelList>(() => emptyModelList)

let latest = 0

/** Fetches the list for a provider; a newer call makes older responses stale. */
export async function loadModels(
  providerUrl: string,
  providerId: string | null
) {
  const request = ++latest
  if (!providerUrl.trim()) return
  const set = (patch: Partial<ModelList>) => {
    if (request === latest) useModelsStore.setState(patch)
  }
  set({ providerUrl, providerId, models: [], isLoading: true, error: null })
  try {
    const models = await listModels({
      base_url: providerUrl,
      ...(providerId ? { id: providerId } : {}),
    })
    set({ models, isLoading: false })
  } catch (cause) {
    set({ isLoading: false, error: errorMessage(cause) })
  }
}
