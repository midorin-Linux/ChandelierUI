import { useMemo } from "react"
import { create, useStore } from "zustand"
import {
  cancelChat,
  chatCompletion,
  deleteApiKey,
  storage,
} from "@/src/lib/api"
import { emptyMetrics, toAttemptRequest } from "@/src/lib/analysis"
import {
  completionStream,
  type CompletionStream,
} from "@/src/lib/completionStream"
import { modelsView, type ModelList } from "@/src/lib/models"
import {
  add,
  deletePreset,
  sessionProvider,
  update,
} from "@/src/lib/providerPresets"
import { retryHead } from "@/src/lib/retry"
import { createSessionStore, type SessionState } from "@/src/lib/sessionStore"
import { pathToRoot } from "@/src/lib/sessionTree"
import { errorMessage } from "@/src/lib/utils"
import { loadModels, useModelsStore } from "@/src/stores/models"
import {
  loadSettings,
  setDefaults,
  setLastSessionId,
  setPresets,
  useSettingsStore,
} from "@/src/stores/settings"
import type { MeasuredCompletion } from "@/src/types/analysis"
import type {
  ProviderChatRequest,
  ProviderPreset,
  SessionDefaults,
} from "@/src/types/chat"
import type { MessageNode, SessionData } from "@/src/types/session"

interface ChatState {
  stream: CompletionStream
  error: string | null
  /** A send or session switch is running; others are refused until it ends. */
  locked: boolean
}

/** Run state of the conversation view; the conversation itself is in `session`. */
export const useChatStore = create<ChatState>(() => ({
  stream: { attemptId: 0, isPending: false, message: null },
  error: null,
  locked: false,
}))

const setError = (error: string | null) => useChatStore.setState({ error })
const dispatchStream = (event: Parameters<typeof completionStream>[1]) =>
  useChatStore.setState((s) => ({ stream: completionStream(s.stream, event) }))

export const session = createSessionStore(storage, {
  onError: (cause) => setError(errorMessage(cause)),
  onActivate: setLastSessionId,
  defaults: () => useSettingsStore.getState().defaults,
})

export function useSession<T>(selector: (state: SessionState) => T) {
  return useStore(session.store, selector)
}

let starting: Promise<void> | null = null

/** Loads settings, then restores the last session. Runs once. */
export function init() {
  starting ??= loadSettings().then(() =>
    session.restore(useSettingsStore.getState().lastSessionId)
  )
  return starting
}

// ---- Derived values -------------------------------------------------------

function deriveContext(
  presets: ProviderPreset[],
  defaults: SessionDefaults,
  data: Pick<SessionData, "provider_id" | "model">,
  list: ModelList
) {
  // The session's own preset, else the new-chat default (`provider.active_id`).
  const { id: providerId, missing: providerMissing } = sessionProvider(
    presets,
    data.provider_id,
    defaults.providerId
  )
  const providerUrl = presets.find((p) => p.id === providerId)?.baseUrl ?? ""
  const view = modelsView(list, providerUrl, providerId, data.model)
  return {
    providerId,
    providerMissing,
    providerUrl,
    ...view,
    canSend: !view.modelsLoading && view.selectedModel !== "",
  }
}

export type ChatContext = ReturnType<typeof deriveContext>

/** The provider and model a request would use now. */
export function getContext(): ChatContext {
  const { presets, defaults } = useSettingsStore.getState()
  return deriveContext(
    presets,
    defaults,
    session.store.getState().data,
    useModelsStore.getState()
  )
}

export function useChatContext(): ChatContext {
  const presets = useSettingsStore((s) => s.presets)
  const defaults = useSettingsStore((s) => s.defaults)
  const providerIdSaved = useSession((s) => s.data.provider_id)
  const model = useSession((s) => s.data.model)
  const list = useModelsStore()
  return useMemo(
    () =>
      deriveContext(
        presets,
        defaults,
        { provider_id: providerIdSaved, model },
        list
      ),
    [presets, defaults, providerIdSaved, model, list]
  )
}

const pathOf = (data: SessionData) =>
  pathToRoot(data.messages, data.branches[data.current_branch])

/** The messages on the current branch, root first. */
export function useMessages() {
  const data = useSession((s) => s.data)
  const messages = data.messages
  const head = data.branches[data.current_branch]
  return useMemo(() => pathToRoot(messages, head), [messages, head])
}

export function useBusy() {
  const locked = useChatStore((s) => s.locked)
  const restoring = useSession((s) => s.restoring)
  return locked || restoring
}

// ---- Requests -------------------------------------------------------------

export function buildPayload(
  history: readonly MessageNode[],
  context: ChatContext,
  data: Pick<SessionData, "reasoning_effort" | "system_prompt">
): ProviderChatRequest {
  return {
    provider: {
      ...(context.providerId ? { id: context.providerId } : {}),
      base_url: context.providerUrl,
    },
    request: {
      model: context.selectedModel,
      reasoning_effort: data.reasoning_effort,
      messages: [
        ...(data.system_prompt.trim()
          ? [{ role: "system" as const, content: data.system_prompt }]
          : []),
        ...history.map(({ role, content }) => ({ role, content })),
      ],
    },
  }
}

/** `context` and `settings` are taken when the send is accepted, not after the save. */
async function requestCompletion(
  sessionId: string,
  headId: string,
  history: MessageNode[],
  retry: boolean,
  context: ChatContext,
  settings: Pick<SessionData, "reasoning_effort" | "system_prompt">
) {
  setError(null)
  const requestPayload = buildPayload(history, context, settings)
  const startedAt = new Date().toISOString()
  const started = performance.now()
  const id = session.nextAttemptId()
  dispatchStream({ type: "start", attemptId: id })
  const contextLength =
    context.models.find((model) => model.id === context.selectedModel)
      ?.context_length ?? null
  let result: MeasuredCompletion
  let reply: MessageNode | null = null
  try {
    result = await chatCompletion(requestPayload, (delta) =>
      dispatchStream({ type: "delta", attemptId: id, delta })
    )
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
    request: toAttemptRequest(requestPayload, settings.system_prompt, headId),
    context_length: contextLength,
    result: { error: result.error, metrics: result.metrics },
  })
}

const isBusy = () =>
  useChatStore.getState().locked || session.store.getState().restoring

/** Runs `task` as the only operation: sends, session switches and restores exclude each other. */
async function exclusive(task: () => Promise<void>) {
  if (isBusy()) return
  useChatStore.setState({ locked: true })
  try {
    await task()
  } catch (cause) {
    setError(errorMessage(cause))
  } finally {
    useChatStore.setState({ locked: false })
  }
}

const cannotSend = (context: ChatContext) =>
  `Cannot send: ${context.modelsStatus} Open Provider settings, confirm the URL with Enter or Refresh, and select a model.`

/** `node` is the user message to commit first; a retry passes `null` and resends from the head. */
function submit(headId: string, node: MessageNode | null) {
  const retry = node === null
  const messages = pathOf(session.store.getState().data)
  // A retry must end with the user message it resends; anything else is a no-op.
  if (retry && retryHead(messages) !== headId) return Promise.resolve()
  const history = node ? [...messages, node] : messages
  return exclusive(async () => {
    const context = getContext()
    const settings = session.store.getState().data
    // Retry saves too: an earlier save may have failed, or the model may have been unset.
    const sessionId = await session.persist(
      node,
      context.selectedModel,
      context.providerId
    )
    if (!context.canSend) {
      if (!retry) setError(cannotSend(context))
      return
    }
    await requestCompletion(
      sessionId,
      headId,
      history,
      retry,
      context,
      settings
    )
  })
}

/**
 * Branches off `parentHead` and requests a reply: regenerate passes `node = null`,
 * edit passes the new user node. Checks `canSend` first so no empty branch is left behind.
 */
function fork(parentHead: string | null, node: MessageNode | null) {
  if (isBusy()) return
  const context = getContext()
  if (!context.canSend) {
    setError(cannotSend(context))
    return
  }
  const headId = node?.id ?? parentHead
  if (headId === null) return
  // Nodes are append-only, so this is right even if the branch changes meanwhile.
  const history = [
    ...pathToRoot(session.store.getState().data.messages, parentHead),
    ...(node ? [node] : []),
  ]
  const settings = session.store.getState().data
  void exclusive(async () => {
    session.branch(parentHead)
    const sessionId = await session.persist(
      node,
      context.selectedModel,
      context.providerId
    )
    await requestCompletion(
      sessionId,
      headId,
      history,
      node === null,
      context,
      settings
    )
  })
}

// ---- Actions for the UI ---------------------------------------------------

/** Returns false when the message was not accepted, so the draft is kept. */
export function sendMessage(content: string) {
  if (isBusy() || !content.trim()) return false
  const data = session.store.getState().data
  const node: MessageNode = {
    id: crypto.randomUUID(),
    parent_id: data.branches[data.current_branch],
    role: "user",
    content,
    created_at: Date.now(),
  }
  void submit(node.id, node)
  return true
}

export function retry() {
  const retryFrom = retryHead(pathOf(session.store.getState().data))
  if (retryFrom) void submit(retryFrom, null)
}

export function regenerate(reply: MessageNode) {
  fork(reply.parent_id, null)
}

export function editMessage(original: MessageNode, content: string) {
  if (!content.trim()) return
  fork(original.parent_id, {
    id: crypto.randomUUID(),
    parent_id: original.parent_id,
    role: "user",
    content,
    created_at: Date.now(),
  })
}

export function switchBranch(nodeId: string) {
  if (isBusy()) return
  setError(null)
  dispatchStream({ type: "reset" })
  session.switchBranch(nodeId)
}

export async function cancelCompletion() {
  if (!useChatStore.getState().locked) return
  try {
    await cancelChat()
  } catch (cause) {
    setError(errorMessage(cause))
  }
}

function switchSession(action: () => Promise<void>) {
  void exclusive(async () => {
    setError(null)
    dispatchStream({ type: "reset" })
    await action()
  })
}

export const newSession = () =>
  switchSession(() => session.startNew(getContext().selectedModel))
export const openSession = (id: string) => switchSession(() => session.open(id))
export const deleteSession = (id: string) =>
  switchSession(() => session.remove(id, getContext().selectedModel))
export const renameSession = (id: string, title: string) =>
  void session.rename(id, title)

export const setEffort = (effort: SessionData["reasoning_effort"]) =>
  session.edit({ reasoning_effort: effort })
export const setSystemPrompt = (prompt: string) =>
  session.edit({ system_prompt: prompt })

export function selectModel(model: string) {
  const { modelsLoading, models } = getContext()
  if (modelsLoading || !models.some((entry) => entry.id === model)) return
  session.edit({ model })
}

export function refreshModels() {
  const { providerUrl, providerId } = getContext()
  void loadModels(providerUrl, providerId)
}

// ---- Provider presets -----------------------------------------------------

/** An explicit choice: saved to the session, and the default for new chats. */
export function selectProvider(id: string | null) {
  session.edit({ provider_id: id })
  setDefaults({ providerId: id })
}

/** Only called when the URL is confirmed (Enter / Fetch / close). */
export function setProviderUrl(url: string) {
  const { providerId } = getContext()
  const { presets } = useSettingsStore.getState()
  if (providerId) setPresets(update(presets, providerId, { baseUrl: url }))
}

export function renamePreset(name: string) {
  const { providerId } = getContext()
  const { presets } = useSettingsStore.getState()
  if (providerId) setPresets(update(presets, providerId, { name }), true)
}

export function addPreset() {
  const preset = { id: crypto.randomUUID(), name: "New provider", baseUrl: "" }
  setPresets(add(useSettingsStore.getState().presets, preset))
  selectProvider(preset.id)
}

/** Rejects (keeping the preset) when the key cannot be deleted. */
export async function removePreset() {
  const { providerId } = getContext()
  if (!providerId) return
  // The browser preview has no keyring, so only the preset goes.
  const next = await deletePreset(
    useSettingsStore.getState().presets,
    providerId,
    providerId,
    deleteApiKey
  )
  setPresets(next.presets)
  selectProvider(next.activeId)
}
