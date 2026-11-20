import { useCallback, useEffect, useRef, useState } from "react"
import { isTauri } from "@tauri-apps/api/core"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { storage } from "@/src/lib/storage"
import { createWriteQueue } from "@/src/lib/writeQueue"

export const SETTING_BASE_URL = "provider.base_url"
export const SETTING_LAST_SESSION = "ui.last_session_id"
export const SETTING_DEFAULT_EFFORT = "session.default_effort"
export const SETTING_DEFAULT_MODEL = "session.default_model"
export const SETTING_DEFAULT_PROMPT = "session.default_system_prompt"

const SAVE_DELAY_MS = 500

type Pending = { value: unknown; timer: ReturnType<typeof setTimeout> }

/**
 * `settings` is null until the first read finishes. Failures are non-fatal, so only logged.
 * Every write goes through one queue, so the last call for a key is the last one stored.
 * `setSettingDebounced` is for text typed key by key: only the final value is
 * written, 500ms after the last call, or by `flushSettings` / unmount / window close.
 */
export function useSettings() {
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null)
  const [enqueue] = useState(createWriteQueue)
  const pending = useRef(new Map<string, Pending>())

  useEffect(() => {
    storage
      .getSettings()
      .then(setSettings)
      .catch((cause) => {
        console.error("Could not read settings", cause)
        setSettings({})
      })
  }, [])

  const write = useCallback(
    (key: string, value: unknown) =>
      enqueue(() => storage.setSetting(key, value)).catch((cause) =>
        console.error(`Could not save ${key}`, cause)
      ),
    [enqueue]
  )

  const cancelPending = useCallback((key: string) => {
    clearTimeout(pending.current.get(key)?.timer)
    pending.current.delete(key)
  }, [])

  const setSetting = useCallback(
    (key: string, value: unknown) => {
      cancelPending(key) // a stale debounced value must not land after this one
      void write(key, value)
    },
    [cancelPending, write]
  )

  /** Writes every pending debounced value now. */
  const flushSettings = useCallback(() => {
    const entries = [...pending.current]
    entries.forEach(([key]) => cancelPending(key))
    return Promise.all(entries.map(([key, { value }]) => write(key, value))).then(
      () => undefined
    )
  }, [cancelPending, write])

  const setSettingDebounced = useCallback(
    (key: string, value: unknown) => {
      clearTimeout(pending.current.get(key)?.timer)
      const timer = setTimeout(() => {
        pending.current.delete(key)
        void write(key, value)
      }, SAVE_DELAY_MS)
      pending.current.set(key, { value, timer })
    },
    [write]
  )

  // Write pending values on unmount and before the window closes.
  useEffect(() => {
    const unlisten = isTauri()
      ? getCurrentWindow().onCloseRequested(() => flushSettings())
      : null
    return () => {
      void flushSettings()
      void unlisten?.then((stop) => stop())
    }
  }, [flushSettings])

  return { settings, setSetting, setSettingDebounced, flushSettings }
}
