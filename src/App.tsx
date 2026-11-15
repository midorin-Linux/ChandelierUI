import "./App.css"
import { useRef, useState } from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { Analysis } from "@/src/components/Analysis"
import { ChatUI } from "@/src/components/ChatUI"
import { MessageBox } from "@/src/components/MessageBox"
import { ProviderSettings } from "@/src/components/ProviderSettings"
import { useModels } from "@/src/hooks/useModels"
import { emptyMetrics } from "@/src/lib/analysis"
import { errorMessage } from "@/src/lib/utils"
import type {
  CompletionAttempt,
  MeasuredCompletion,
} from "@/src/types/analysis"
import type { ChatMessage, Effort, ProviderChatRequest } from "@/src/types/chat"

function App() {
  const [providerUrl, setProviderUrl] = useState("")
  const [providerUrlInput, setProviderUrlInput] = useState("")
  const {
    models,
    modelsLoading,
    selectedModel,
    modelsStatus,
    selectModel,
    refreshModels,
  } = useModels(providerUrl)
  const [selectedEffort, setSelectedEffort] = useState<Effort>("medium")
  const [systemPrompt, setSystemPrompt] = useState("")
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attempts, setAttempts] = useState<CompletionAttempt[]>([])
  const attemptId = useRef(0)
  const inFlight = useRef(false)
  const canSend = !modelsLoading && selectedModel !== ""

  function buildPayload(history: ChatMessage[]): ProviderChatRequest {
    return {
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
  }

  async function requestCompletion(history: ChatMessage[], retry = false) {
    if (inFlight.current || !canSend) return
    inFlight.current = true
    setIsPending(true)
    setError(null)
    const requestPayload = buildPayload(history)
    const startedAt = new Date().toISOString()
    const started = performance.now()
    const id = ++attemptId.current
    const contextLength =
      models.find((model) => model.id === selectedModel)?.context_length ?? null
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
      const message = errorMessage(cause)
      setError(message)
      result = {
        message: null,
        error: message,
        metrics: emptyMetrics(performance.now() - started),
      }
    } finally {
      inFlight.current = false
      setIsPending(false)
    }
    setAttempts((current) => [
      ...current,
      {
        id,
        started_at: startedAt,
        retry,
        concurrency: 1,
        payload: requestPayload,
        context_length: contextLength,
        result,
      },
    ])
  }

  function sendMessage(content: string) {
    if (inFlight.current || !content.trim()) return false
    if (!canSend) {
      setError(
        `Cannot send: ${modelsStatus} Open Provider settings, confirm the URL with Enter or Refresh, and select a model.`
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
      <div className="flex justify-center h-screen">
        <div className="flex min-h-0 flex-col max-w-4xl w-full border-x">
          <div className="flex shrink-0 justify-end gap-2 px-4 py-2 border-b">
            <ProviderSettings
              providerUrl={providerUrl}
              setProviderUrl={setProviderUrl}
              providerUrlInput={providerUrlInput}
              setProviderUrlInput={setProviderUrlInput}
              models={models}
              selectedModel={selectedModel}
              onModelChange={selectModel}
              modelsLoading={modelsLoading}
              modelsStatus={modelsStatus}
              onRefreshModels={refreshModels}
            />
            <Analysis
              payload={buildPayload(messages)}
              attempts={attempts}
              isPending={isPending}
            />
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
