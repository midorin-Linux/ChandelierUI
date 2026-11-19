import "./App.css"
import { useCallback, useReducer, useRef, useState } from "react"
import { Channel, invoke, isTauri } from "@tauri-apps/api/core"
import { Analysis } from "@/src/components/Analysis"
import { ChatUI } from "@/src/components/ChatUI"
import { MessageBox } from "@/src/components/MessageBox"
import { AppSetting, type SettingsTab } from "@/src/components/AppSetting"
import { Dialog } from "@/src/components/ui/dialog"
import { useModels } from "@/src/hooks/useModels"
import { useSession } from "@/src/hooks/useSession"
import {
  SETTING_BASE_URL,
  SETTING_LAST_SESSION,
  useSettings,
} from "@/src/hooks/useSettings"
import { emptyMetrics, redactPayload } from "@/src/lib/analysis"
import { completionStream } from "@/src/lib/completionStream"
import { errorMessage } from "@/src/lib/utils"
import type { MeasuredCompletion } from "@/src/types/analysis"
import type {
  ChatMessage,
  CompletionDelta,
  ProviderChatRequest,
} from "@/src/types/chat"
import { ThemeProvider } from "@/src/components/ThemeProvider.tsx"
import { SidebarProvider } from "@/src/components/ui/sidebar"
import { AppSidebar } from "@/src/components/AppSidebar"

function App() {
  const { settings, setSetting } = useSettings()
  if (!settings) return null
  return <Chat settings={settings} setSetting={setSetting} />
}

function Chat({
  settings,
  setSetting,
}: {
  settings: Record<string, unknown>
  setSetting: (key: string, value: unknown) => void
}) {
  const savedUrl = settings[SETTING_BASE_URL]
  const lastSession = settings[SETTING_LAST_SESSION]
  const [providerUrl, setProviderUrlState] = useState(
    typeof savedUrl === "string" ? savedUrl : ""
  )
  const [apiKey, setApiKey] = useState("")
  const [appSettingsOpen, setAppSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general")
  const [providerUrlInput, setProviderUrlInput] = useState(providerUrl)
  const [error, setError] = useState<string | null>(null)
  const session = useSession(
    setError,
    useCallback(
      (id: string | null) => setSetting(SETTING_LAST_SESSION, id),
      [setSetting]
    ),
    typeof lastSession === "string" ? lastSession : null
  )
  const {
    models,
    modelsLoading,
    selectedModel,
    modelsStatus,
    selectModel,
    refreshModels,
  } = useModels(providerUrl, apiKey, session.data.model, (model) =>
    session.edit({ model })
  )
  const selectedEffort = session.data.reasoning_effort
  const systemPrompt = session.data.system_prompt
  const messages = session.data.messages
  const [stream, dispatchStream] = useReducer(completionStream, {
    attemptId: 0,
    isPending: false,
    message: null,
  })
  const { isPending } = stream
  const inFlight = useRef(false)
  const canSend = !modelsLoading && selectedModel !== ""

  // Only called when the URL is confirmed (Enter / Fetch).
  function setProviderUrl(url: string) {
    setProviderUrlState(url)
    setSetting(SETTING_BASE_URL, url)
  }

  function openProviderSettings() {
    setSettingsTab("provider")
    setAppSettingsOpen(true)
  }

  function buildPayload(history: ChatMessage[]): ProviderChatRequest {
    const trimmedKey = apiKey.trim()
    return {
      provider: {
        base_url: providerUrl,
        ...(trimmedKey ? { api_key: trimmedKey } : {}),
      },
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

  async function requestCompletion(
    sessionId: string,
    history: ChatMessage[],
    retry: boolean
  ) {
    setError(null)
    const requestPayload = buildPayload(history)
    const startedAt = new Date().toISOString()
    const started = performance.now()
    const id = session.nextAttemptId()
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
        void session.commit(sessionId, [...history, result.message])
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
      dispatchStream({ type: "finish", attemptId: id, succeeded })
    }
    session.recordAttempt(sessionId, {
      id,
      started_at: startedAt,
      retry,
      concurrency: 1,
      payload: redactPayload(requestPayload),
      context_length: contextLength,
      result,
    })
  }

  // `inFlight` also locks session switching while the history is being saved.
  async function submit(history: ChatMessage[], retry = false) {
    if (inFlight.current) return
    inFlight.current = true
    try {
      const sessionId =
        retry && session.activeId
          ? session.activeId
          : await session.persist(history, selectedModel)
      if (!canSend) {
        if (!retry) {
          setError(
            `Cannot send: ${modelsStatus} Open Provider settings, confirm the URL with Enter or Refresh, and select a model.`
          )
        }
        return
      }
      await requestCompletion(sessionId, history, retry)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      inFlight.current = false
    }
  }

  function sendMessage(content: string) {
    if (inFlight.current || !content.trim()) return false
    void submit([...messages, { role: "user", content }])
    return true
  }

  function switchSession(action: () => Promise<void>) {
    if (inFlight.current) return
    setError(null)
    dispatchStream({ type: "reset" })
    void action()
  }

  async function cancelCompletion() {
    if (!inFlight.current || !isTauri()) return
    try {
      await invoke("cancel_chat")
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  return (
    <>
      <ThemeProvider defaultTheme="system">
        <SidebarProvider>
          <AppSidebar
            sessions={session.sessions}
            activeId={session.activeId}
            disabled={isPending}
            onNew={() => switchSession(() => session.startNew(selectedModel))}
            onSelect={(id) => switchSession(() => session.open(id))}
            onRename={(id, title) => void session.rename(id, title)}
            onDelete={(id) =>
              switchSession(() => session.remove(id, selectedModel))
            }
            onOpenSettings={() => setAppSettingsOpen(true)}
          />
          <Dialog open={appSettingsOpen} onOpenChange={setAppSettingsOpen}>
            <AppSetting
              tab={settingsTab}
              onTabChange={setSettingsTab}
              provider={{
                providerUrl,
                setProviderUrl,
                providerUrlInput,
                setProviderUrlInput,
                apiKey,
                setApiKey,
                models,
                modelsLoading,
                modelsStatus,
                onRefreshModels: refreshModels,
              }}
            />
          </Dialog>
          <div className="flex h-screen min-w-0 flex-1 justify-center">
            <div className="flex min-h-0 w-full flex-col">
              <div className="flex shrink-0 justify-end px-4 py-2 border-b">
                <div className="flex gap-2">
                  <Analysis
                    payload={buildPayload(messages)}
                    attempts={session.attempts}
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
                  onRetry={() => void submit(messages, true)}
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
                    onOpenProviderSettings={openProviderSettings}
                    selectedModel={selectedModel}
                    onModelChange={selectModel}
                    selectedEffort={selectedEffort}
                    onEffortChange={(effort) =>
                      session.edit({ reasoning_effort: effort })
                    }
                    systemPrompt={systemPrompt}
                    onSystemPromptChange={(prompt) =>
                      session.edit({ system_prompt: prompt })
                    }
                    onSend={sendMessage}
                    onCancel={() => void cancelCompletion()}
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
