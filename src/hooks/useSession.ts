import { useCallback, useEffect, useRef, useState } from "react"
import { storage } from "@/src/lib/storage"
import { errorMessage } from "@/src/lib/utils"
import type { CompletionAttempt } from "@/src/types/analysis"
import type { ChatMessage } from "@/src/types/chat"
import type { SessionData, SessionSummary } from "@/src/types/session"

const SAVE_DELAY_MS = 500

function emptyData(model: string): SessionData {
  return {
    model,
    reasoning_effort: "medium",
    system_prompt: "",
    messages: [],
  }
}

/**
 * The active conversation and the session list, persisted through `storage`.
 * `data` is mirrored in a ref so debounced saves always see the latest value.
 * Callers must not switch sessions while a completion is in flight.
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
  const started = useRef(false)

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

  /** Writes a pending debounced save now; call before leaving the session. */
  const flush = useCallback(async () => {
    if (saveTimer.current === undefined) return
    cancelSave()
    const id = idRef.current
    if (id) {
      await storage.saveSession(id, dataRef.current).then(refresh).catch(fail)
    }
  }, [fail, refresh])

  const open = useCallback(
    async (id: string) => {
      await flush()
      try {
        const loaded = await storage.loadSession(id)
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
    [flush, fail, onActivate]
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
  }, [initialId, open, fail])

  function reset(model: string) {
    cancelSave()
    apply(emptyData(model))
    setAttempts([])
    attemptCounter.current = 0
    activate(null)
  }

  /** Model, effort and system prompt edits; saved 500ms after the last one. */
  function edit(patch: Partial<Omit<SessionData, "messages">>) {
    apply({ ...dataRef.current, ...patch })
    if (!idRef.current) return
    cancelSave()
    saveTimer.current = setTimeout(() => void flush(), SAVE_DELAY_MS)
  }

  /** Saves history before a request, creating the session on first use. Returns its id. */
  async function persist(messages: ChatMessage[], model: string) {
    const next = {
      ...dataRef.current,
      messages,
      model: model || dataRef.current.model,
    }
    apply(next)
    cancelSave()
    let id = idRef.current
    if (id) await storage.saveSession(id, next)
    else {
      id = (await storage.createSession(next)).id
      activate(id)
    }
    void refresh()
    return id
  }

  /** Saves the finished reply to the session the request started in. */
  async function commit(id: string, messages: ChatMessage[]) {
    if (idRef.current !== id) return
    apply({ ...dataRef.current, messages })
    await storage.saveSession(id, dataRef.current).then(refresh).catch(fail)
  }

  function recordAttempt(id: string, attempt: CompletionAttempt) {
    if (idRef.current === id) setAttempts((current) => [...current, attempt])
    storage.appendAttempt(id, attempt).then(refresh).catch(fail)
  }

  async function startNew(model: string) {
    await flush()
    reset(model)
  }

  async function remove(id: string, model: string) {
    if (id === idRef.current) reset(model)
    await storage.deleteSession(id).then(refresh).catch(fail)
  }

  async function rename(id: string, title: string) {
    await storage.renameSession(id, title).then(refresh).catch(fail)
  }

  return {
    sessions,
    activeId,
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
