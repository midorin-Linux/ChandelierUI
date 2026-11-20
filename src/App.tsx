import "./App.css"
import { useCallback, useMemo, useReducer, useRef, useState } from "react"
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
  SETTING_DEFAULT_EFFORT,
  SETTING_DEFAULT_MODEL,
  SETTING_DEFAULT_PROMPT,
  SETTING_LAST_SESSION,
  useSettings,
} from "@/src/hooks/useSettings"
import { emptyMetrics, toAttemptRequest } from "@/src/lib/analysis"
import { completionStream } from "@/src/lib/completionStream"
import { retryHead } from "@/src/lib/retry"
import { pathToRoot } from "@/src/lib/sessionTree"
import { errorMessage } from "@/src/lib/utils"
import type { MeasuredCompletion } from "@/src/types/analysis"
import {
  efforts,
  type CompletionDelta,
  type ProviderChatRequest,
  type SessionDefaults,
} from "@/src/types/chat"
import type { MessageNode } from "@/src/types/session"
import { ThemeProvider } from "@/src/components/ThemeProvider.tsx"
import { SidebarProvider } from "@/src/components/ui/sidebar"
import { AppSidebar } from "@/src/components/AppSidebar"

function App() {
  const { settings, ...store } = useSettings()
  // The theme stays outside the settings gate so it applies without waiting for IPC.
  return (
    <ThemeProvider defaultTheme="system">
      {settings && <Chat settings={settings} {...store} />}
    </ThemeProvider>
  )
}

function Chat({
  settings,
  setSetting,
  setSettingDebounced,
  flushSettings,
}: {
  settings: Record<string, unknown>
  setSetting: (key: string, value: unknown) => void
  setSettingDebounced: (key: string, value: unknown) => void
  flushSettings: () => Promise<void>
}) {
  const savedUrl = settings[SETTING_BASE_URL]
  const lastSession = settings[SETTING_LAST_SESSION]
  const [providerUrl, setProviderUrlState] = useState(
    typeof savedUrl === "string" ? savedUrl : ""
  )
  const [defaults, setDefaultsState] = useState<SessionDefaults>(() => ({
    effort:
      efforts.find((e) => e === settings[SETTING_DEFAULT_EFFORT]) ?? "off",
    model:
      typeof settings[SETTING_DEFAULT_MODEL] === "string"
        ? settings[SETTING_DEFAULT_MODEL]
        : "",
    systemPrompt:
      typeof settings[SETTING_DEFAULT_PROMPT] === "string"
        ? settings[SETTING_DEFAULT_PROMPT]
        : "",
  }))
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
    typeof lastSession === "string" ? lastSession : null,
    defaults
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
  const head = session.data.branches[session.data.current_branch]
  const messages = useMemo(
    () => pathToRoot(session.data.messages, head),
    [session.data.messages, head]
  )
  const [stream, dispatchStream] = useReducer(completionStream, {
    attemptId: 0,
    isPending: false,
    message: null,
  })
  const { isPending } = stream
  const inFlight = useRef(false)
  // Mirrors `inFlight` for rendering. While set, sending and switching are disabled.
  const [locked, setLocked] = useState(false)
  const busy = locked || session.restoring
  const canSend = !modelsLoading && selectedModel !== ""

  // Only called when the URL is confirmed (Enter / Fetch).
  function setProviderUrl(url: string) {
    setProviderUrlState(url)
    setSetting(SETTING_BASE_URL, url)
  }

  function setDefaults(next: SessionDefaults) {
    setDefaultsState(next)
    if (next.effort !== defaults.effort)
      setSetting(SETTING_DEFAULT_EFFORT, next.effort)
    if (next.model !== defaults.model)
      setSetting(SETTING_DEFAULT_MODEL, next.model)
    // Typed key by key, so saved once typing pauses.
    if (next.systemPrompt !== defaults.systemPrompt)
      setSettingDebounced(SETTING_DEFAULT_PROMPT, next.systemPrompt)
  }

  function openProviderSettings() {
    setSettingsTab("provider")
    setAppSettingsOpen(true)
  }

  function buildPayload(history: readonly MessageNode[]): ProviderChatRequest {
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
    headId: string,
    history: MessageNode[],
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
    let reply: MessageNode | null = null
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
        reply = {
          id: crypto.randomUUID(),
          parent_id: headId,
          role: "assistant",
          content: result.message.content,
          reasoning: result.message.reasoning,
          created_at: Date.now(),
        }
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
      dispatchStream({
        type: "finish",
        attemptId: id,
        succeeded: reply !== null,
      })
    }
    // Same tick as `finish`, so the partial message is replaced without a gap.
    if (reply) await session.commit(sessionId, reply)
    await session.recordAttempt(sessionId, {
      version: 1,
      id,
      started_at: startedAt,
      retry,
      concurrency: 1,
      request: toAttemptRequest(requestPayload, systemPrompt, headId),
      context_length: contextLength,
      result: { error: result.error, metrics: result.metrics },
    })
  }

  /** Runs `task` as the only operation: sends, session switches and restores exclude each other. */
  async function exclusive(task: () => Promise<void>) {
    if (inFlight.current || session.restoring) return
    inFlight.current = true
    setLocked(true)
    try {
      await task()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      inFlight.current = false
      setLocked(false)
    }
  }

  /** `node` is the user message to commit first; a retry passes `null` and resends from the head. */
  function submit(headId: string, node: MessageNode | null) {
    const retry = node === null
    // A retry must end with the user message it resends; anything else is a no-op.
    if (retry && retryHead(messages) !== headId) return Promise.resolve()
    const history = node ? [...messages, node] : messages
    return exclusive(async () => {
      // Retry saves too: an earlier save may have failed, or the model may have been unset.
      const sessionId = await session.persist(node, selectedModel)
      if (!canSend) {
        if (!retry) {
          setError(
            `Cannot send: ${modelsStatus} Open Provider settings, confirm the URL with Enter or Refresh, and select a model.`
          )
        }
        return
      }
      await requestCompletion(sessionId, headId, history, retry)
    })
  }

  function sendMessage(content: string) {
    if (inFlight.current || session.restoring || !content.trim()) return false
    const node: MessageNode = {
      id: crypto.randomUUID(),
      parent_id: head,
      role: "user",
      content,
      created_at: Date.now(),
    }
    void submit(node.id, node)
    return true
  }

  function switchSession(action: () => Promise<void>) {
    void exclusive(async () => {
      setError(null)
      dispatchStream({ type: "reset" })
      await action()
    })
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
      <SidebarProvider>
        <AppSidebar
          sessions={session.sessions}
          activeId={session.activeId}
          disabled={busy}
          onNew={() => switchSession(() => session.startNew(selectedModel))}
          onSelect={(id) => switchSession(() => session.open(id))}
          onRename={(id, title) => void session.rename(id, title)}
          onDelete={(id) =>
            switchSession(() => session.remove(id, selectedModel))
          }
          onOpenSettings={() => setAppSettingsOpen(true)}
        />
        <Dialog
          open={appSettingsOpen}
          onOpenChange={(open) => {
            setAppSettingsOpen(open)
            if (!open) void flushSettings()
          }}
        >
          <AppSetting
            tab={settingsTab}
            onTabChange={setSettingsTab}
            models={models}
            defaults={defaults}
            onDefaultsChange={setDefaults}
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
                busy={busy}
                error={error}
                canSend={canSend}
                onRetry={() => {
                  const retryFrom = retryHead(messages)
                  if (retryFrom) void submit(retryFrom, null)
                }}
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
                  disabled={busy}
                />
              </div>
            </div>
          </div>
        </div>
      </SidebarProvider>
    </>
  )
}

export default App
