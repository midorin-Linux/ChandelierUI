import "./App.css"
import { useEffect, useRef, useState } from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { MessageBox } from "@/src/components/MessageBox.tsx"
import { ProviderSettings } from "@/src/components/ProviderSettings"
import { ChatUI } from "@/src/components/ChatUI"
import { Analysis } from "@/src/components/Analysis"
import type {
  ApiModel,
  ChatMessage,
  Effort,
  ProviderChatRequest,
} from "@/src/types/chat"

import type { CompletionAttempt, MeasuredCompletion } from "@/src/types/analysis"
function App() {
  const [providerUrl, setProviderUrl] = useState("")
  const [providerUrlInput, setProviderUrlInput] = useState("")
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
  const [selectedEffort, setSelectedEffort] = useState<Effort>("medium")
  const [systemPrompt, setSystemPrompt] = useState("")
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attempts, setAttempts] = useState<CompletionAttempt[]>([])
  const attemptId = useRef(0)
  const inFlight = useRef(false)
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
  const canSend = !modelsLoading && selectedModel !== ""
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
      isLoading: Boolean(providerUrl.trim()),
      error: null,
    }))

    async function loadModels() {
      try {
        if (!isTauri()) {
          throw new Error(
            "Loading models requires the Tauri desktop app. Open the desktop app instead of the browser preview."
          )
        }
        if (!providerUrl.trim()) return
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
          error: cause instanceof Error ? cause.message : String(cause),
        })
      }
    }
    void loadModels()
    return () => {
      cancelled = true
    }
  }, [providerUrl, modelsRefresh])
  const payload: ProviderChatRequest = {
    provider: { base_url: providerUrl },
    request: {
      model: selectedModel,
      reasoning_effort: selectedEffort,
      messages: [
        ...(systemPrompt.trim()
          ? [{ role: "system" as const, content: systemPrompt }]
          : []),
        ...messages,
      ],
    },
  }
  async function requestCompletion(history: ChatMessage[], retry = false) {
    if (inFlight.current || !canSend) return
    inFlight.current = true
    setIsPending(true)
    setError(null)
    const requestPayload: ProviderChatRequest = {
      provider: { base_url: providerUrl },
      request: {
        model: selectedModel,
        reasoning_effort: selectedEffort,
        messages: [
          ...(systemPrompt.trim()
            ? [{ role: "system" as const, content: systemPrompt }]
            : []),
          ...history,
        ],
      },
    }
    const startedAt = new Date().toISOString()
    const started = performance.now()
    const id = ++attemptId.current
    const contextLength = models.find((model) => model.id === selectedModel)?.context_length ?? null
    let result: MeasuredCompletion
    try {
      if (!isTauri()) {
        throw new Error(
          "Sending messages requires the Tauri desktop app. Open the desktop app instead of the browser preview."
        )
      }
      result = await invoke<MeasuredCompletion>("chat_completion", {
        payload: requestPayload,
      })
      if (result.error) setError(result.error)
      else if (result.message) setMessages([...history, result.message])
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      result = {
        message: null, error: message,
        metrics: {
          ttft_ms: null, ttfb_ms: null, e2e_ms: performance.now() - started,
          decode_ms: null, prefill_ms: null, server_decode_ms: null,
          connection_ms: null, dns_ms: null, tcp_ms: null, tls_ms: null,
          output_tps: null, tpot_ms: null,
          itl_mean_ms: null, itl_max_ms: null, itl_stddev_ms: null,
          chunk_interval_mean_ms: null, chunk_interval_max_ms: null, chunk_interval_stddev_ms: null,
          input_tokens: null, output_tokens: null, total_tokens: null,
          cached_tokens: null, reasoning_tokens: null,
          http_status: null, finish_reason: null, timed_out: false,
        },
      }
    } finally {
      inFlight.current = false
      setIsPending(false)
    }
    setAttempts((current) => [...current, {
      id, started_at: startedAt, retry, concurrency: 1,
      payload: requestPayload, context_length: contextLength, result,
    }])
  }

  function sendMessage(content: string) {
    if (inFlight.current || !content.trim()) return false
    if (!canSend) {
      setError(
        `Cannot send: ${modelsStatus} Open Provider settings, confirm the URL with Enter, and select a model.`
      )
      return false
    }
    const history: ChatMessage[] = [...messages, { role: "user", content }]
    setMessages(history)
    void requestCompletion(history)
    return true
  }
  return (
    <>
      <div className="chat-ui flex justify-center h-screen">
        <div className="flex min-h-0 flex-col max-w-4xl w-full border-x">
          <div className="flex shrink-0 justify-end gap-2 px-4 py-2 border-b">
            <ProviderSettings
              providerUrl={providerUrl}
              setProviderUrl={setProviderUrl}
              providerUrlInput={providerUrlInput}
              setProviderUrlInput={setProviderUrlInput}
              models={models}
              selectedModel={selectedModel}
              selectModel={selectModel}
              modelsLoading={modelsLoading}
              modelsStatus={modelsStatus}
              refreshModels={refreshModels}
            />
            <Analysis payload={payload} attempts={attempts} isPending={isPending} />
          </div>
          <ChatUI
            messages={messages}
            isPending={isPending}
            error={error}
            canSend={canSend}
            onRetry={() => void requestCompletion(messages, true)}
          />
          <MessageBox
            models={models}
            modelsLoading={modelsLoading}
            modelsStatus={modelsStatus}
            onRefreshModels={refreshModels}
            selectedModel={selectedModel}
            onModelChange={selectModel}
            selectedEffort={selectedEffort}
            onEffortChange={setSelectedEffort}
            systemPrompt={systemPrompt}
            onSystemPromptChange={setSystemPrompt}
            onSend={sendMessage}
            isPending={isPending}
          />
        </div>
      </div>
    </>
  )
}

export default App
