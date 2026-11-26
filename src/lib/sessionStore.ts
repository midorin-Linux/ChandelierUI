import { createStore } from "zustand/vanilla"
import type { CompletionAttempt } from "../types/analysis.ts"
import type { SessionDefaults } from "../types/chat.ts"
import type {
  MessageNode,
  SessionData,
  SessionSummary,
  Storage,
} from "../types/session.ts"
import { emptyData } from "./sessionDefaults.ts"
import {
  commit as commitNode,
  createBranch,
  selectBranchFor,
} from "./sessionTree.ts"
import { createWriteQueue } from "./writeQueue.ts"

export interface SessionState {
  sessions: SessionSummary[]
  activeId: string | null
  data: SessionData
  attempts: CompletionAttempt[]
  /** True until the saved session has been restored; callers must not send meanwhile. */
  restoring: boolean
}

/**
 * The active conversation and the session list, persisted through `storage`.
 * Callers must not switch sessions while a completion is in flight.
 *
 * Every storage write and load goes through one queue, so a load never sees
 * data older than an earlier write. `rev` / `savedRev` track unsaved edits: a
 * failed save keeps them dirty, and leaving the session then fails instead of
 * discarding them.
 */
export function createSessionStore(
  storage: Storage,
  hooks: {
    onError: (cause: unknown) => void
    onActivate: (id: string | null) => void
    /** Read at call time: settings may load after the store is created. */
    defaults: () => SessionDefaults
  },
  saveDelayMs = 500
) {
  const store = createStore<SessionState>(() => ({
    sessions: [],
    activeId: null,
    data: emptyData("", hooks.defaults()),
    attempts: [],
    restoring: true,
  }))
  const { getState: get, setState: set } = store
  const enqueue = createWriteQueue()
  let rev = 0
  let savedRev = 0
  let attemptCounter = 0
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let restoring: Promise<void> | null = null

  const refresh = () =>
    storage
      .listSessions()
      .then((sessions) => set({ sessions }))
      .catch(hooks.onError)

  const apply = (data: SessionData) => set({ data })

  function activate(id: string | null) {
    set({ activeId: id })
    hooks.onActivate(id)
  }

  function cancelSave() {
    clearTimeout(saveTimer)
    saveTimer = undefined
  }

  /** Saves the current data; edits made while it runs stay dirty. */
  async function saveNow(id: string) {
    await enqueue(async () => {
      const target = rev
      await storage.saveSession(id, get().data)
      savedRev = Math.max(savedRev, target)
    })
    void refresh()
  }

  /** Writes unsaved edits now. Rejects if that fails, so callers can abort leaving the session. */
  async function flush() {
    cancelSave()
    const id = get().activeId
    if (id && rev > savedRev) await saveNow(id)
  }

  function scheduleSave() {
    if (!get().activeId) return
    cancelSave()
    saveTimer = setTimeout(() => void flush().catch(hooks.onError), saveDelayMs)
  }

  async function open(id: string) {
    await flush() // outside the try: a failed save aborts leaving the session
    try {
      const loaded = await enqueue(() => storage.loadSession(id))
      apply(loaded.data)
      set({ attempts: loaded.attempts })
      attemptCounter = loaded.attempts.reduce(
        (max, attempt) => Math.max(max, attempt.id),
        0
      )
      activate(id)
    } catch (cause) {
      hooks.onError(cause)
    }
  }

  function reset(model: string) {
    cancelSave()
    savedRev = rev
    apply(emptyData(model, hooks.defaults()))
    set({ attempts: [] })
    attemptCounter = 0
    activate(null)
  }

  return {
    store,
    flush,
    open,

    /** Lists sessions and reopens `initialId` if it still exists. Runs once; later calls share it. */
    restore(initialId: string | null) {
      restoring ??= (async () => {
        apply(emptyData("", hooks.defaults())) // defaults were not loaded at creation
        try {
          const list = await storage.listSessions()
          set({ sessions: list })
          if (initialId && list.some((session) => session.id === initialId)) {
            await open(initialId)
          }
        } catch (cause) {
          hooks.onError(cause)
        } finally {
          set({ restoring: false })
        }
      })()
      return restoring
    },

    nextAttemptId: () => ++attemptCounter,

    /** Model, effort, system prompt and provider edits; saved `saveDelayMs` after the last one. */
    edit(
      patch: Partial<
        Omit<SessionData, "messages" | "branches" | "current_branch">
      >
    ) {
      apply({ ...get().data, ...patch })
      rev++
      scheduleSave()
    },

    /** Starts a new current branch at `head`. Saved by the `persist` that follows. */
    branch(head: string | null) {
      apply(createBranch(get().data, head))
      rev++
    },

    /** Shows a branch containing `nodeId`; saved like `edit`, since switching alone must persist. */
    switchBranch(nodeId: string) {
      const next = selectBranchFor(get().data, nodeId)
      if (next === get().data) return
      apply(next)
      rev++
      scheduleSave()
    },

    /**
     * Commits `node` if given, then saves before a request, creating the session on first use.
     * Records the model and provider the request goes to. Returns the session id.
     */
    async persist(
      node: MessageNode | null,
      model: string,
      providerId: string | null
    ) {
      const current = get().data
      const base = {
        ...current,
        model: model || current.model,
        provider_id: providerId,
      }
      const next = node ? commitNode(base, node) : base
      apply(next)
      rev++ // dirty until saved, so leaving the session retries a failed save
      cancelSave()
      const target = rev
      let id = get().activeId
      if (id) await saveNow(id)
      else {
        id = (await enqueue(() => storage.createSession(next))).id
        savedRev = Math.max(savedRev, target)
        activate(id)
        void refresh()
      }
      return id
    },

    /** Saves the finished reply to the session the request started in. */
    async commit(id: string, node: MessageNode) {
      if (get().activeId !== id) return
      apply(commitNode(get().data, node))
      rev++
      await saveNow(id).catch(hooks.onError)
    },

    /** Resolves once the attempt is stored, so callers can hold their lock until then. */
    async recordAttempt(id: string, attempt: CompletionAttempt) {
      if (get().activeId === id) set({ attempts: [...get().attempts, attempt] })
      await enqueue(() => storage.appendAttempt(id, attempt))
        .then(refresh)
        .catch(hooks.onError)
    },

    async startNew(model: string) {
      await flush()
      reset(model)
    },

    async remove(id: string, model: string) {
      if (id === get().activeId) reset(model)
      await enqueue(() => storage.deleteSession(id))
        .then(refresh)
        .catch(hooks.onError)
    },

    async rename(id: string, title: string) {
      await enqueue(() => storage.renameSession(id, title))
        .then(refresh)
        .catch(hooks.onError)
    },
  }
}

export type SessionStore = ReturnType<typeof createSessionStore>
