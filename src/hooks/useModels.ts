import { useEffect, useState } from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { errorMessage } from "@/src/lib/utils"
import type { ApiModel } from "@/src/types/chat"

export function useModels(providerUrl: string) {
  const [modelList, setModelList] = useState<{
    providerUrl: string
    models: ApiModel[]
    selectedModel: string
    isLoading: boolean
    error: string | null
  }>({
    providerUrl: "",
    models: [],
    selectedModel: "",
    isLoading: false,
    error: null,
  })
  const [modelsRefresh, setModelsRefresh] = useState(0)
  const models = modelList.providerUrl === providerUrl ? modelList.models : []
  const modelsLoading =
    modelList.providerUrl === providerUrl
      ? modelList.isLoading
      : Boolean(providerUrl.trim())
  const selectedModel = models.some(
    (model) => model.id === modelList.selectedModel
  )
    ? modelList.selectedModel
    : ""
  const modelsStatus =
    modelList.providerUrl === providerUrl && modelList.error
      ? modelList.error
      : modelsLoading
        ? "Loading models…"
        : !providerUrl.trim()
          ? "Enter a provider URL and press Enter to load models."
          : models.length === 0
            ? "The provider returned no models."
            : `${models.length} models loaded.`

  function selectModel(model: string) {
    if (modelsLoading || !models.some((entry) => entry.id === model)) return
    setModelList((current) => ({ ...current, selectedModel: model }))
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
    setModelList((current) => ({
      providerUrl,
      models: [],
      selectedModel:
        current.providerUrl === providerUrl ? current.selectedModel : "",
      isLoading: true,
      error: null,
    }))

    async function loadModels() {
      try {
        if (!isTauri()) {
          throw new Error(
            "Loading models requires the Tauri desktop app. Open the desktop app instead of the browser preview."
          )
        }
        const fetchedModels = await invoke<ApiModel[]>("list_models", {
          provider: { base_url: providerUrl },
        })
        if (cancelled) return
        setModelList((current) => ({
          providerUrl,
          models: fetchedModels,
          selectedModel: fetchedModels.some(
            (model) => model.id === current.selectedModel
          )
            ? current.selectedModel
            : (fetchedModels[0]?.id ?? ""),
          isLoading: false,
          error: null,
        }))
      } catch (cause) {
        if (cancelled) return
        setModelList({
          providerUrl,
          models: [],
          selectedModel: "",
          isLoading: false,
          error: errorMessage(cause),
        })
      }
    }
    void loadModels()
    return () => {
      cancelled = true
    }
  }, [providerUrl, modelsRefresh])

  return {
    models,
    modelsLoading,
    selectedModel,
    modelsStatus,
    selectModel,
    refreshModels,
  }
}
