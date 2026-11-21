import "./App.css"
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react"
import { Channel, invoke, isTauri } from "@tauri-apps/api/core"
import { Analysis } from "@/src/components/Analysis"
import { TitleBar } from "@/src/components/TitleBar"
import { ChatUI } from "@/src/components/ChatUI"
import { MessageBox } from "@/src/components/MessageBox"
import { AppSetting, type SettingsTab } from "@/src/components/AppSetting"
import { Dialog } from "@/src/components/ui/dialog"
import { useModels } from "@/src/hooks/useModels"
import { useSession } from "@/src/hooks/useSession"
import {
  SETTING_ACTIVE_ID,
  SETTING_BASE_URL,
  SETTING_DEFAULT_EFFORT,
  SETTING_DEFAULT_MODEL,
  SETTING_DEFAULT_PROMPT,
  SETTING_LAST_SESSION,
  SETTING_PRESETS,
  useSettings,
} from "@/src/hooks/useSettings"
import { emptyMetrics, toAttemptRequest } from "@/src/lib/analysis"
import { completionStream } from "@/src/lib/completionStream"
import {
  add,
  deletePreset,
  migrate,
  sessionProvider,
  update,
} from "@/src/lib/providerPresets"
import { retryHead } from "@/src/lib/retry"
import { pathToRoot } from "@/src/lib/sessionTree"
import { errorMessage } from "@/src/lib/utils"
import type { MeasuredCompletion } from "@/src/types/analysis"
import {
  efforts,
  type CompletionDelta,
  type ProviderChatRequest,
  type ProviderPreset,
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
  const lastSession = settings[SETTING_LAST_SESSION]
  const [presets, setPresets] = useState(() =>
    migrate(settings[SETTING_PRESETS], settings[SETTING_BASE_URL])
  )
  const [defaults, setDefaultsState] = useState<SessionDefaults>(() => ({
    providerId:
      presets.find((p) => p.id === settings[SETTING_ACTIVE_ID])?.id ??
      presets[0]?.id ??
      null,
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
  const [appSettingsOpen, setAppSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general")
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
  // The session's own preset, else the new-chat default (`provider.active_id`).
  const { id: activeId, missing: providerMissing } = sessionProvider(
    presets,
    session.data.provider_id,
    defaults.providerId
  )
  const providerUrl = presets.find((p) => p.id === activeId)?.baseUrl ?? ""
  // The URL being typed belongs to one preset, so switching presets drops it.
  const [urlDraft, setUrlDraft] = useState({ id: activeId, value: providerUrl })
  const providerUrlInput =
    urlDraft.id === activeId ? urlDraft.value : providerUrl
  const setProviderUrlInput = (value: string) =>
    setUrlDraft({ id: activeId, value })
  const {
    models,
    modelsLoading,
    selectedModel,
    modelsStatus,
    selectModel,
    refreshModels,
  } = useModels(
    providerUrl,
    activeId,
    session.data.model,
    (model) => session.edit({ model }),
    flushSettings
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

  // A migrated legacy URL gets its generated id saved right away, because
  // the API key is stored under that id.
  useEffect(() => {
    if (Array.isArray(settings[SETTING_PRESETS]) || presets.length === 0) return
    setSetting(SETTING_PRESETS, presets)
    setSetting(SETTING_ACTIVE_ID, defaults.providerId)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function savePresets(next: ProviderPreset[], debounced = false) {
    setPresets(next)
    if (debounced) setSettingDebounced(SETTING_PRESETS, next)
    else setSetting(SETTING_PRESETS, next)
  }

  /** An explicit choice: saved to the session, and the default for new chats. */
  function selectProvider(id: string | null) {
    session.edit({ provider_id: id })
    setDefaults({ ...defaults, providerId: id })
  }

  // Only called when the URL is confirmed (Enter / Fetch).
  function setProviderUrl(url: string) {
    if (activeId) savePresets(update(presets, activeId, { baseUrl: url }))
  }

  function addPreset() {
    const preset = {
      id: crypto.randomUUID(),
      name: "New provider",
      baseUrl: "",
    }
    const next = add(presets, preset)
    savePresets(next)
    selectProvider(preset.id)
  }

  /** Rejects (keeping the preset) when the key cannot be deleted. */
  async function removePreset() {
    if (!activeId) return
    // The browser preview has no keyring, so only the preset goes.
    const next = await deletePreset(presets, activeId, activeId, (id) =>
      isTauri()
        ? invoke("delete_api_key", { providerId: id })
        : Promise.resolve()
    )
    savePresets(next.presets)
    selectProvider(next.activeId)
  }

  function setDefaults(next: SessionDefaults) {
    setDefaultsState(next)
    if (next.providerId !== defaults.providerId)
      setSetting(SETTING_ACTIVE_ID, next.providerId)
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
    return {
      provider: {
        ...(activeId ? { id: activeId } : {}),
        base_url: providerUrl,
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
      await flushSettings() // the backend resolves the preset from stored settings
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
      const sessionId = await session.persist(node, selectedModel, activeId)
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

  /**
   * Branches off `parentHead` and requests a reply: regenerate passes `node = null`,
   * edit passes the new user node. Checks `canSend` first so no empty branch is left behind.
   */
  function fork(parentHead: string | null, node: MessageNode | null) {
    if (inFlight.current || session.restoring) return
    if (!canSend) {
      setError(
        `Cannot send: ${modelsStatus} Open Provider settings, confirm the URL with Enter or Refresh, and select a model.`
      )
      return
    }
    const headId = node?.id ?? parentHead
    if (headId === null) return
    // Nodes are append-only, so this is right even if `messages` is stale.
    const history = [
      ...pathToRoot(session.data.messages, parentHead),
      ...(node ? [node] : []),
    ]
    void exclusive(async () => {
      session.branch(parentHead)
      const sessionId = await session.persist(node, selectedModel, activeId)
      await requestCompletion(sessionId, headId, history, node === null)
    })
  }

  function editMessage(original: MessageNode, content: string) {
    if (!content.trim()) return
    fork(original.parent_id, {
      id: crypto.randomUUID(),
      parent_id: original.parent_id,
      role: "user",
      content,
      created_at: Date.now(),
    })
  }

  function switchBranch(nodeId: string) {
    if (busy) return
    setError(null)
    dispatchStream({ type: "reset" })
    session.switchBranch(nodeId)
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
            if (open) return
            // Escape/close unmounts the URL field without a blur.
            const url = providerUrlInput.trim()
            if (url !== providerUrl) setProviderUrl(url)
            void flushSettings()
          }}
        >
          <AppSetting
            tab={settingsTab}
            onTabChange={setSettingsTab}
            models={models}
            defaults={defaults}
            onDefaultsChange={setDefaults}
            provider={{
              presets,
              activeId,
              onSelectPreset: selectProvider,
              onAddPreset: addPreset,
              onRemovePreset: removePreset,
              onRenamePreset: (name) =>
                activeId &&
                savePresets(update(presets, activeId, { name }), true),
              providerUrl,
              setProviderUrl,
              providerUrlInput,
              setProviderUrlInput,
              models,
              modelsLoading,
              modelsStatus,
              onRefreshModels: refreshModels,
            }}
          />
        </Dialog>
        <div className="flex h-screen min-w-0 flex-1 justify-center">
          <div className="flex min-h-0 w-full flex-col">
            <TitleBar>
              <Analysis
                payload={buildPayload(messages)}
                attempts={session.attempts}
                isPending={isPending}
              />
            </TitleBar>
            <div className="relative flex min-h-0 w-full flex-1 flex-col">
              <ChatUI
                messages={messages}
                allMessages={session.data.messages}
                partialMessage={stream.message}
                isPending={isPending}
                busy={busy}
                error={error}
                canSend={canSend}
                onRetry={() => {
                  const retryFrom = retryHead(messages)
                  if (retryFrom) void submit(retryFrom, null)
                }}
                onRegenerate={(reply) => fork(reply.parent_id, null)}
                onEdit={editMessage}
                onSwitch={switchBranch}
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
                {providerMissing && (
                  <p
                    role="status"
                    className="px-3 pb-1 text-xs text-muted-foreground"
                  >
                    This session&apos;s provider has been deleted. Using the
                    current provider instead.
                  </p>
                )}
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
