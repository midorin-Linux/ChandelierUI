import { useCallback, useEffect, useState } from "react"
import { storage } from "@/src/lib/storage"

export const SETTING_BASE_URL = "provider.base_url"
export const SETTING_LAST_SESSION = "ui.last_session_id"
export const SETTING_DEFAULT_EFFORT = "session.default_effort"
export const SETTING_DEFAULT_MODEL = "session.default_model"
export const SETTING_DEFAULT_PROMPT = "session.default_system_prompt"

/** `settings` is null until the first read finishes. Failures are non-fatal, so only logged. */
export function useSettings() {
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null)

  useEffect(() => {
    storage
      .getSettings()
      .then(setSettings)
      .catch((cause) => {
        console.error("Could not read settings", cause)
        setSettings({})
      })
  }, [])

  const setSetting = useCallback((key: string, value: unknown) => {
    storage
      .setSetting(key, value)
      .catch((cause) => console.error(`Could not save ${key}`, cause))
  }, [])

  return { settings, setSetting }
}
