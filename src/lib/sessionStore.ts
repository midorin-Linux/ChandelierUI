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
 * Sessions may be switched while a completion is in flight: `commit` and
 * `recordAttempt` then write to the stored copy of the session it belongs to.
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

  /**
   * Saves the current data; edits made while it runs stay dirty. Snapshotted now,
   * not when the job runs, so a session switched in meanwhile is never saved as `id`.
   */
  async function saveNow(id: string) {
    const data = get().data
    const target = rev
    await enqueue(async () => {
      await storage.saveSession(id, data)
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

    /** Saves the finished reply to the session the request started in, even if it is not shown. */
    async commit(id: string, node: MessageNode) {
      const has = (data: SessionData) =>
        data.messages.some((message) => message.id === node.id)
      // ponytail: if this save fails after the user switched away, the reply is
      // reported but not retried (the shown session no longer holds it). Keep it
      // in a pending list per session if storage failures become a real concern.
      if (get().activeId !== id) {
        try {
          await enqueue(async () => {
            const { data } = await storage.loadSession(id)
            if (!has(data))
              await storage.saveSession(id, commitNode(data, node))
          })
        } catch (cause) {
          hooks.onError(cause)
          return
        }
        void refresh()
        // Reopened meanwhile: the loaded copy may predate the reply.
        if (get().activeId !== id || has(get().data)) return
      }
      apply(commitNode(get().data, node))
      rev++
      await saveNow(id).catch(hooks.onError)
    },

    /** Resolves once the attempt is stored, so callers can hold their lock until then. */
    async recordAttempt(id: string, attempt: CompletionAttempt) {
      const show = () => {
        if (get().activeId !== id) return
        // Reopening mid-request reseeds the counter without this attempt.
        attemptCounter = Math.max(attemptCounter, attempt.id)
        const { attempts } = get()
        if (!attempts.some((a) => a.id === attempt.id))
          set({ attempts: [...attempts, attempt] })
      }
      show()
      await enqueue(() => storage.appendAttempt(id, attempt))
        .then(refresh)
        .catch(hooks.onError)
      show() // reopened while it was stored
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
