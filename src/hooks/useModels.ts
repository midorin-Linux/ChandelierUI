import { useEffect, useState } from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { errorMessage } from "@/src/lib/utils"
import type { ApiModel } from "@/src/types/chat"

/**
 * `preferredModel` (the session's saved model) is selected once the list contains it,
 * otherwise the first model; `onSelect` receives the user's choice.
 */
export function useModels(
  providerUrl: string,
  providerId: string | null,
  preferredModel: string,
  onSelect: (model: string) => void,
  /** Resolves once saved presets are stored; the backend resolves `providerId` from them. */
  settingsSaved: () => Promise<void>
) {
  const [modelList, setModelList] = useState<{
    providerUrl: string
    models: ApiModel[]
    isLoading: boolean
    error: string | null
  }>({
    providerUrl: "",
    models: [],
    isLoading: false,
    error: null,
  })
  const [modelsRefresh, setModelsRefresh] = useState(0)
  const models = modelList.providerUrl === providerUrl ? modelList.models : []
  const modelsLoading =
    modelList.providerUrl === providerUrl
      ? modelList.isLoading
      : Boolean(providerUrl.trim())
  const selectedModel = models.some((model) => model.id === preferredModel)
    ? preferredModel
    : (models[0]?.id ?? "")
  const modelsStatus =
    modelList.providerUrl === providerUrl && modelList.error
      ? modelList.error
      : modelsLoading
        ? "Loading models…"
        : !providerUrl.trim()
          ? "Enter a provider URL and press Enter or click Refresh to load models."
          : models.length === 0
            ? "The provider returned no models."
            : `${models.length} models loaded.`

  function selectModel(model: string) {
    if (modelsLoading || !models.some((entry) => entry.id === model)) return
    onSelect(model)
  }

  function refreshModels() {
    setModelList((current) => ({
      ...current,
      models: [],
      isLoading: Boolean(providerUrl.trim()),
      error: null,
    }))
    setModelsRefresh((current) => current + 1)
  }

  useEffect(() => {
    let cancelled = false
    if (!providerUrl.trim()) return

    async function loadModels() {
      try {
        if (!isTauri()) {
          throw new Error(
            "Loading models requires the Tauri desktop app. Open the desktop app instead of the browser preview."
          )
        }
        await settingsSaved()
        if (cancelled) return
        const fetchedModels = await invoke<ApiModel[]>("list_models", {
          provider: {
            base_url: providerUrl,
            ...(providerId ? { id: providerId } : {}),
          },
        })
        if (cancelled) return
        setModelList({
          providerUrl,
          models: fetchedModels,
          isLoading: false,
          error: null,
        })
      } catch (cause) {
        if (cancelled) return
        setModelList({
          providerUrl,
          models: [],
          isLoading: false,
          error: errorMessage(cause),
        })
      }
    }
    void loadModels()
    return () => {
      cancelled = true
    }
  }, [providerUrl, providerId, modelsRefresh, settingsSaved])

  return {
    models,
    modelsLoading,
    selectedModel,
    modelsStatus,
    selectModel,
    refreshModels,
  }
}
