import "./App.css"
import { useReducer, useRef, useState } from "react"
import { Channel, invoke, isTauri } from "@tauri-apps/api/core"
import { Analysis } from "@/src/components/Analysis"
import { ChatUI } from "@/src/components/ChatUI"
import { MessageBox } from "@/src/components/MessageBox"
import { ProviderSettings } from "@/src/components/ProviderSettings"
import { ThemeMenu } from "@/src/components/ThemeMenu"
import { useModels } from "@/src/hooks/useModels"
import { emptyMetrics } from "@/src/lib/analysis"
import { completionStream } from "@/src/lib/completionStream"
import { errorMessage } from "@/src/lib/utils"
import type {
  CompletionAttempt,
  MeasuredCompletion,
} from "@/src/types/analysis"
import type {
  ChatMessage,
  CompletionDelta,
  Effort,
  ProviderChatRequest,
} from "@/src/types/chat"
import { ThemeProvider } from "@/src/components/ThemeProvider.tsx"
import { SidebarProvider } from "@/src/components/ui/sidebar"
import { AppSidebar } from "@/src/components/AppSidebar"

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
  const [stream, dispatchStream] = useReducer(completionStream, {
    attemptId: 0,
    isPending: false,
    message: null,
  })
  const { isPending } = stream
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
          ...history.map(({ role, content }) => ({ role, content })),
        ],
      },
    }
  }

  async function requestCompletion(history: ChatMessage[], retry = false) {
    if (inFlight.current || !canSend) return
    inFlight.current = true
    setError(null)
    const requestPayload = buildPayload(history)
    const startedAt = new Date().toISOString()
    const started = performance.now()
    const id = ++attemptId.current
    dispatchStream({ type: "start", attemptId: id })
    const contextLength =
      models.find((model) => model.id === selectedModel)?.context_length ?? null
    let result: MeasuredCompletion
    let succeeded = false
    try {
      if (!isTauri()) {
        throw new Error(
          "Sending messages requires the Tauri desktop app. Open the desktop app instead of the browser preview."
        )
      }
      const onEvent = new Channel<CompletionDelta>((delta) => {
        dispatchStream({ type: "delta", attemptId: id, delta })
      })
      result = await invoke<MeasuredCompletion>("chat_completion", {
        payload: requestPayload,
        onEvent,
      })
      if (result.error) setError(result.error)
      else if (result.message) {
        succeeded = true
        setMessages([...history, result.message])
      }
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
      dispatchStream({ type: "finish", attemptId: id, succeeded })
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
    const history: ChatMessage[] = [...messages, { role: "user", content }]
    setMessages(history)
    if (!canSend) {
      setError(
        `Cannot send: ${modelsStatus} Open Provider settings, confirm the URL with Enter or Refresh, and select a model.`
      )
      return true
    }
    void requestCompletion(history)
    return true
  }

  return (
    <>
      <ThemeProvider defaultTheme="system">
        <SidebarProvider>
          <AppSidebar />
          <div className="flex h-screen min-w-0 flex-1 justify-center">
            <div className="flex min-h-0 w-full flex-col">
              <div className="flex shrink-0 justify-between px-4 py-2 border-b">
                <div className="flex items-center gap-2">
                  <ThemeMenu />
                </div>
                <div className="flex gap-2">
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
              </div>
              <div className="relative flex min-h-0 w-full flex-1 flex-col">
                <ChatUI
                  messages={messages}
                  partialMessage={stream.message}
                  isPending={isPending}
                  error={error}
                  canSend={canSend}
                  onRetry={() => void requestCompletion(messages, true)}
                />
                <div
                  className="absolute bottom-0 left-1/2 w-full max-w-3xl -translate-x-1/2 border-x border-transparent"
                  ref={(node) => {
                    if (!node) return
                    const observer = new ResizeObserver(() => {
                      node.parentElement?.style.setProperty(
                        "--composer-height",
                        `${node.offsetHeight}px`
                      )
                    })
                    observer.observe(node)
                    return () => observer.disconnect()
                  }}
                >
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
            </div>
          </div>
        </SidebarProvider>
      </ThemeProvider>
    </>
  )
}

export default App
