import { useMemo } from "react"
import { create, useStore } from "zustand"
import {
  ApiError,
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
import { modelsView, type ModelLists } from "@/src/lib/models"
import {
  add,
  deletePreset,
  sessionProvider,
  uniqueName,
  update,
} from "@/src/lib/providerPresets"
import { retryHead } from "@/src/lib/retry"
import { createSessionStore, type SessionState } from "@/src/lib/sessionStore"
import { pathToRoot } from "@/src/lib/sessionTree"
import { errorMessage } from "@/src/lib/utils"
import { forgetModels, loadModels, useModelsStore } from "@/src/stores/models"
import {
  loadSettings,
  setDefaults,
  setLastSessionId,
  setPresets,
  useSettingsStore,
} from "@/src/stores/settings"
import type { MeasuredCompletion } from "@/src/types/analysis"
import type { ErrorKind } from "@/src/types/error"
import type {
  ProviderChatRequest,
  ProviderPreset,
  SessionDefaults,
} from "@/src/types/chat"
import type { MessageNode, SessionData } from "@/src/types/session"

interface ChatState {
  stream: CompletionStream
  /** The session `stream` belongs to; the stream is shown only there. */
  streamSessionId: string | null
  error: string | null
  /** The session a request error belongs to; null for errors shown anywhere. */
  errorSessionId: string | null
  /** Why a request failed, for a specific hint; null for other errors. */
  errorCause: { kind: ErrorKind | null; status: number | null } | null
  /** A send is running, from the first save to the stored attempt. One at a time. */
  sending: boolean
  /** A session is being opened, started or deleted. */
  switching: boolean
}

/** Run state of the conversation view; the conversation itself is in `session`. */
export const useChatStore = create<ChatState>(() => ({
  stream: { attemptId: 0, isPending: false, message: null },
  streamSessionId: null,
  error: null,
  errorSessionId: null,
  errorCause: null,
  sending: false,
  switching: false,
}))

const setError = (error: string | null, errorSessionId: string | null = null) =>
  useChatStore.setState({ error, errorSessionId, errorCause: null })
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
  lists: ModelLists
) {
  // The session's own preset, else the new-chat default (`provider.active_id`).
  const { id: providerId, missing: providerMissing } = sessionProvider(
    presets,
    data.provider_id,
    defaults.providerId
  )
  const preset = presets.find((p) => p.id === providerId) ?? null
  const view = modelsView(lists, preset, data.model)
  return {
    providerId,
    providerMissing,
    providerUrl: preset?.baseUrl ?? "",
    providerName: preset ? presetLabel(preset) : "",
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
  const lists = useModelsStore()
  return useMemo(
    () =>
      deriveContext(
        presets,
        defaults,
        { provider_id: providerIdSaved, model },
        lists
      ),
    [presets, defaults, providerIdSaved, model, lists]
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

/** Sending, switching or restoring: no new send, edit or branch switch. */
export function useBusy() {
  const busy = useChatStore((s) => s.sending || s.switching)
  const restoring = useSession((s) => s.restoring)
  return busy || restoring
}

/**
 * Sessions can be switched while a reply streams, but not while a send is
 * saving first (a new chat gets its id then) or storing the result.
 */
const switchBlocked = (s: ChatState) =>
  s.switching || (s.sending && !s.stream.isPending)

export function useCanSwitch() {
  const blocked = useChatStore(switchBlocked)
  const restoring = useSession((s) => s.restoring)
  return !blocked && !restoring
}

/** The session a reply is streaming into, if any. */
export const useStreamingSessionId = () =>
  useChatStore((s) => (s.sending ? s.streamSessionId : null))

/** The current error, unless it belongs to another session. */
export function useError() {
  const activeId = useSession((s) => s.activeId)
  return useChatStore((s) =>
    s.errorSessionId === null || s.errorSessionId === activeId ? s.error : null
  )
}

/** Why the shown request error happened, if it came from a request. */
export function useErrorCause() {
  const activeId = useSession((s) => s.activeId)
  return useChatStore((s) =>
    s.errorSessionId === activeId ? s.errorCause : null
  )
}

/** The stream, if it belongs to the session on screen. */
export function useActiveStream() {
  const activeId = useSession((s) => s.activeId)
  const message = useChatStore((s) =>
    s.streamSessionId === activeId ? s.stream.message : null
  )
  const isPending = useChatStore(
    (s) => s.streamSessionId === activeId && s.stream.isPending
  )
  return { message, isPending }
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
  // Shown only in its own session (a switch may still be loading); the attempt log keeps it too.
  const fail = (
    message: string,
    kind: ErrorKind | null,
    status: number | null = null
  ) =>
    useChatStore.setState({
      error: message,
      errorSessionId: sessionId,
      errorCause: { kind, status },
    })
  const requestPayload = buildPayload(history, context, settings)
  const startedAt = new Date().toISOString()
  const started = performance.now()
  const id = session.nextAttemptId()
  useChatStore.setState({ streamSessionId: sessionId })
  dispatchStream({ type: "start", attemptId: id })
  const contextLength =
    context.models.find((model) => model.id === context.selectedModel)
      ?.context_length ?? null
  let result: MeasuredCompletion
  let reply: MessageNode | null = null
  // Thinking time: first reasoning delta to first content delta (or the end).
  let thinkingFrom: number | null = null
  let thinkingTo: number | null = null
  try {
    result = await chatCompletion(requestPayload, (delta) => {
      const now = performance.now()
      if (delta.reasoning && thinkingFrom === null) thinkingFrom = now
      if (delta.content && thinkingTo === null) thinkingTo = now
      dispatchStream({ type: "delta", attemptId: id, delta })
    })
    if (result.error)
      fail(result.error, result.error_kind, result.metrics.http_status)
    else if (result.message) {
      reply = {
        id: crypto.randomUUID(),
        parent_id: headId,
        role: "assistant",
        content: result.message.content,
        reasoning: result.message.reasoning,
        ...(thinkingFrom !== null && {
          reasoning_ms: Math.round(
            Math.max((thinkingTo ?? performance.now()) - thinkingFrom, 0)
          ),
        }),
        created_at: Date.now(),
      }
    }
  } catch (cause) {
    const message = errorMessage(cause)
    fail(message, cause instanceof ApiError ? cause.kind : null)
    result = {
      message: null,
      error: message,
      error_kind: cause instanceof ApiError ? cause.kind : null,
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
    result: {
      error: result.error,
      error_kind: result.error_kind,
      metrics: result.metrics,
    },
  })
}

const isBusy = () => {
  const { sending, switching } = useChatStore.getState()
  return sending || switching || session.store.getState().restoring
}

const canSwitch = () =>
  !switchBlocked(useChatStore.getState()) && !session.store.getState().restoring

/** Runs a send: only one at a time, and never during a switch or restore. */
async function exclusive(task: () => Promise<void>) {
  if (isBusy()) return
  useChatStore.setState({ sending: true })
  try {
    await task()
  } catch (cause) {
    setError(errorMessage(cause))
  } finally {
    useChatStore.setState({ sending: false })
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
  if (!useChatStore.getState().sending) return
  try {
    await cancelChat()
  } catch (cause) {
    setError(errorMessage(cause))
  }
}

/** Allowed while a reply streams: it keeps going and is saved to its own session. */
function switchSession(action: () => Promise<void>) {
  if (!canSwitch()) return
  useChatStore.setState({ switching: true })
  setError(null)
  if (!useChatStore.getState().sending) dispatchStream({ type: "reset" })
  void action()
    .catch((cause) => setError(errorMessage(cause)))
    .finally(() => useChatStore.setState({ switching: false }))
}

/** The chat's model and provider, kept by a new chat when no default model is set. */
function currentChoice() {
  const { providerId, selectedModel } = getContext()
  return { providerId, model: selectedModel }
}

export const newSession = () =>
  switchSession(() => session.startNew(currentChoice()))
export const openSession = (id: string) => switchSession(() => session.open(id))
export function deleteSession(id: string) {
  const { sending, streamSessionId } = useChatStore.getState()
  if (sending && id === streamSessionId) return // its reply still has to be saved
  switchSession(() => session.remove(id, currentChoice()))
}
export const renameSession = (id: string, title: string) =>
  void session.rename(id, title)

export const setEffort = (effort: SessionData["reasoning_effort"]) =>
  session.edit({ reasoning_effort: effort })
export const setSystemPrompt = (prompt: string) =>
  session.edit({ system_prompt: prompt })

/** Switches the chat to `model` of provider `providerId`, once that provider lists it. */
export function selectModel(providerId: string, model: string) {
  const { presets } = useSettingsStore.getState()
  const preset = presets.find((p) => p.id === providerId)
  const view = preset && modelsView(useModelsStore.getState(), preset, model)
  if (!view || view.modelsLoading || view.selectedModel !== model) return
  session.edit({ provider_id: providerId, model })
}

const findPreset = (id: string) =>
  useSettingsStore.getState().presets.find((p) => p.id === id)

/** Refetches one provider's models. */
export function refreshModels(id: string) {
  const preset = findPreset(id)
  if (preset) void loadModels(preset)
}

/** Refetches every provider's models. */
export function refreshAllModels() {
  for (const preset of useSettingsStore.getState().presets)
    void loadModels(preset)
}

// ---- Provider presets -----------------------------------------------------
// Editing a preset never changes which provider a chat uses: that is chosen
// with the model (`selectModel`), and for new chats with the default model.

/** Display name; an emptied name is kept as is but shown as "Untitled". */
export const presetLabel = (preset: ProviderPreset) =>
  preset.name.trim() || "Untitled"

/** Only called when the URL is confirmed (Enter / blur / close). */
export function setPresetUrl(id: string, url: string) {
  const { presets } = useSettingsStore.getState()
  setPresets(update(presets, id, { baseUrl: url }))
}

export function renamePreset(id: string, name: string) {
  const { presets } = useSettingsStore.getState()
  setPresets(update(presets, id, { name }), true)
}

/**
 * Adds a preset, from a template or blank, and returns its id.
 * The first preset also becomes the default provider.
 */
export function addPreset(
  template: Omit<ProviderPreset, "id"> = { name: "New provider", baseUrl: "" }
) {
  const { presets, defaults } = useSettingsStore.getState()
  const preset = {
    id: crypto.randomUUID(),
    name: uniqueName(presets, template.name),
    baseUrl: template.baseUrl,
  }
  setPresets(add(presets, preset))
  if (!defaults.providerId || !findPreset(defaults.providerId))
    setDefaults({ providerId: preset.id })
  return preset.id
}

/**
 * Rejects (keeping the preset) when the key cannot be deleted. Deleting the
 * default model's provider clears the default model; chats that used it fall
 * back to the default provider.
 */
export async function removePreset(id: string) {
  const { presets, defaults } = useSettingsStore.getState()
  // The browser preview has no keyring, so only the preset goes.
  const next = await deletePreset(
    presets,
    defaults.providerId,
    id,
    deleteApiKey
  )
  setPresets(next.presets)
  if (next.activeId !== defaults.providerId)
    setDefaults({ providerId: next.activeId, model: "" })
  forgetModels(id)
}
