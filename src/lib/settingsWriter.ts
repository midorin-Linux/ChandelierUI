import type { Storage } from "../types/session.ts"
import { createWriteQueue } from "./writeQueue.ts"

/** What the settings UI shows: unsaved changes, and the last write that failed. */
export interface SaveStatus {
  /** Values waiting for their debounce or still being written. */
  pending: number
  /** The latest failure, cleared once a later write succeeds. */
  error: string | null
}

/**
 * Every settings write goes through one queue, so the last call for a key is the last one stored.
 * `setDebounced` is for text typed key by key: only the final value is written,
 * `delayMs` after the last call, or by `flush`. Failures are non-fatal: they are logged and
 * reported through `status` until a later write succeeds.
 */
export function createSettingsWriter(
  storage: Pick<Storage, "setSetting">,
  delayMs = 500
) {
  const enqueue = createWriteQueue()
  const pending = new Map<
    string,
    { value: unknown; timer: ReturnType<typeof setTimeout> }
  >()
  let writing = 0
  // Replaced, never mutated, so `status` can be read by `useSyncExternalStore`.
  let status: SaveStatus = { pending: 0, error: null }
  const listeners = new Set<() => void>()

  function update(error = status.error) {
    const next = { pending: pending.size + writing, error }
    if (next.pending === status.pending && next.error === status.error) return
    status = next
    listeners.forEach((listener) => listener())
  }

  const write = (key: string, value: unknown) => {
    writing++
    update()
    return enqueue(() => storage.setSetting(key, value)).then(
      () => {
        writing--
        update(null)
      },
      (cause) => {
        writing--
        console.error(`Could not save ${key}`, cause)
        update(cause instanceof Error ? cause.message : String(cause))
      }
    )
  }

  const cancel = (key: string) => {
    clearTimeout(pending.get(key)?.timer)
    pending.delete(key)
  }

  return {
    set(key: string, value: unknown) {
      cancel(key) // a stale debounced value must not land after this one
      void write(key, value)
    },
    setDebounced(key: string, value: unknown) {
      clearTimeout(pending.get(key)?.timer)
      const timer = setTimeout(() => {
        pending.delete(key)
        void write(key, value)
      }, delayMs)
      pending.set(key, { value, timer })
      update()
    },
    /** Writes every pending value now; resolves once every write queued so far is stored. */
    flush(): Promise<void> {
      const entries = [...pending]
      entries.forEach(([key]) => cancel(key))
      entries.forEach(([key, { value }]) => void write(key, value))
      return enqueue(() => Promise.resolve())
    },
    status: () => status,
    /** Calls `listener` whenever `status` changes; returns the unsubscribe function. */
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
  }
}
