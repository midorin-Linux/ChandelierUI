import { useCallback, useEffect, useRef, useState } from "react"
import { isTauri } from "@tauri-apps/api/core"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { commit as commitNode } from "@/src/lib/sessionTree"
import { storage } from "@/src/lib/storage"
import { errorMessage } from "@/src/lib/utils"
import { createWriteQueue } from "@/src/lib/writeQueue"
import type { CompletionAttempt } from "@/src/types/analysis"
import type {
  MessageNode,
  SessionData,
  SessionSummary,
} from "@/src/types/session"

const SAVE_DELAY_MS = 500

function emptyData(model: string): SessionData {
  return {
    model,
    reasoning_effort: "medium",
    system_prompt: "",
    messages: [],
    branches: { main: null },
    current_branch: "main",
  }
}

/**
 * The active conversation and the session list, persisted through `storage`.
 * `data` is mirrored in a ref so debounced saves always see the latest value.
 * Callers must not switch sessions while a completion is in flight.
 *
 * Every storage write and load goes through one queue, so a load never sees
 * data older than an earlier write. `rev` / `savedRev` track unsaved edits: a
 * failed save keeps them dirty, and leaving the session then fails instead of
 * discarding them.
 */
export function useSession(
  onError: (message: string) => void,
  onActivate: (id: string | null) => void,
  initialId: string | null
) {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [data, setData] = useState<SessionData>(() => emptyData(""))
  const [attempts, setAttempts] = useState<CompletionAttempt[]>([])
  const dataRef = useRef(data)
  const idRef = useRef<string | null>(null)
  const attemptCounter = useRef(0)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [enqueue] = useState(createWriteQueue)
  const rev = useRef(0)
  const savedRev = useRef(0)
  const started = useRef(false)
  // True until the saved session has been restored; callers must not send meanwhile.
  const [restoring, setRestoring] = useState(true)

  const fail = useCallback(
    (cause: unknown) => onError(errorMessage(cause)),
    [onError]
  )

  const refresh = useCallback(
    () => storage.listSessions().then(setSessions).catch(fail),
    [fail]
  )

  function apply(next: SessionData) {
    dataRef.current = next
    setData(next)
  }

  function activate(id: string | null) {
    idRef.current = id
    setActiveId(id)
    onActivate(id)
  }

  function cancelSave() {
    clearTimeout(saveTimer.current)
    saveTimer.current = undefined
  }

  /** Saves the current data; edits made while it runs stay dirty. */
  const saveNow = useCallback(
    async (id: string) => {
      await enqueue(async () => {
        const target = rev.current
        await storage.saveSession(id, dataRef.current)
        savedRev.current = Math.max(savedRev.current, target)
      })
      void refresh()
    },
    [enqueue, refresh]
  )

  /** Writes unsaved edits now. Rejects if that fails, so callers can abort leaving the session. */
  const flush = useCallback(async () => {
    cancelSave()
    const id = idRef.current
    if (id && rev.current > savedRev.current) await saveNow(id)
  }, [saveNow])

  const open = useCallback(
    async (id: string) => {
      await flush()
      try {
        const loaded = await enqueue(() => storage.loadSession(id))
        apply(loaded.data)
        setAttempts(loaded.attempts)
        attemptCounter.current = loaded.attempts.reduce(
          (max, attempt) => Math.max(max, attempt.id),
          0
        )
        activate(id)
      } catch (cause) {
        fail(cause)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- apply/activate only touch refs and stable setters, plus onActivate
    [flush, enqueue, fail, onActivate]
  )

  useEffect(() => {
    if (started.current) return
    started.current = true
    storage
      .listSessions()
      .then((list) => {
        setSessions(list)
        if (initialId && list.some((session) => session.id === initialId)) {
          return open(initialId)
        }
      })
      .catch(fail)
      .finally(() => setRestoring(false))
  }, [initialId, open, fail])

  // Write a pending debounced save before the window closes.
  useEffect(() => {
    if (!isTauri()) return
    // Close even if the save fails: a rejected handler would leave the window stuck open.
    const unlisten = getCurrentWindow().onCloseRequested(() =>
      flush().catch((cause) =>
        console.error("Could not save before closing", cause)
      )
    )
    return () => void unlisten.then((stop) => stop())
  }, [flush])

  function reset(model: string) {
    cancelSave()
    savedRev.current = rev.current
    apply(emptyData(model))
    setAttempts([])
    attemptCounter.current = 0
    activate(null)
  }

  /** Model, effort and system prompt edits; saved 500ms after the last one. */
  function edit(
    patch: Partial<
      Omit<SessionData, "messages" | "branches" | "current_branch">
    >
  ) {
    apply({ ...dataRef.current, ...patch })
    rev.current++
    if (!idRef.current) return
    cancelSave()
    saveTimer.current = setTimeout(
      () => void flush().catch(fail),
      SAVE_DELAY_MS
    )
  }

  /** Commits `node` if given, then saves before a request, creating the session on first use. Returns its id. */
  async function persist(node: MessageNode | null, model: string) {
    const base = { ...dataRef.current, model: model || dataRef.current.model }
    const next = node ? commitNode(base, node) : base
    apply(next)
    rev.current++ // dirty until saved, so leaving the session retries a failed save
    cancelSave()
    const target = rev.current
    let id = idRef.current
    if (id) await saveNow(id)
    else {
      id = (await enqueue(() => storage.createSession(next))).id
      savedRev.current = Math.max(savedRev.current, target)
      activate(id)
      void refresh()
    }
    return id
  }

  /** Saves the finished reply to the session the request started in. */
  async function commit(id: string, node: MessageNode) {
    if (idRef.current !== id) return
    apply(commitNode(dataRef.current, node))
    rev.current++
    await saveNow(id).catch(fail)
  }

  /** Resolves once the attempt is stored, so callers can hold their lock until then. */
  async function recordAttempt(id: string, attempt: CompletionAttempt) {
    if (idRef.current === id) setAttempts((current) => [...current, attempt])
    await enqueue(() => storage.appendAttempt(id, attempt))
      .then(refresh)
      .catch(fail)
  }

  async function startNew(model: string) {
    await flush()
    reset(model)
  }

  async function remove(id: string, model: string) {
    if (id === idRef.current) reset(model)
    await enqueue(() => storage.deleteSession(id))
      .then(refresh)
      .catch(fail)
  }

  async function rename(id: string, title: string) {
    await enqueue(() => storage.renameSession(id, title))
      .then(refresh)
      .catch(fail)
  }

  return {
    sessions,
    activeId,
    restoring,
    data,
    attempts,
    nextAttemptId: () => ++attemptCounter.current,
    edit,
    persist,
    commit,
    recordAttempt,
    open,
    startNew,
    remove,
    rename,
  }
}
