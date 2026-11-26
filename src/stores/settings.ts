import { create } from "zustand"
import { settingsWriter, storage } from "@/src/lib/api"
import { migrate } from "@/src/lib/providerPresets"
import {
  efforts,
  type ProviderPreset,
  type SessionDefaults,
} from "@/src/types/chat"

const SETTING_BASE_URL = "provider.base_url" // legacy single URL, read for migration only
const SETTING_PRESETS = "provider.presets"
const SETTING_ACTIVE_ID = "provider.active_id"
const SETTING_LAST_SESSION = "ui.last_session_id"
const SETTING_DEFAULT_EFFORT = "session.default_effort"
const SETTING_DEFAULT_MODEL = "session.default_model"
const SETTING_DEFAULT_PROMPT = "session.default_system_prompt"
const SETTING_TIMEOUT = "chat.timeout_secs" // read by the backend

// Keep in step with the backend's default and accepted range.
const DEFAULT_TIMEOUT_SECS = 120
export const MAX_TIMEOUT_SECS = 3600
export const isTimeoutSecs = (value: unknown): value is number =>
  Number.isInteger(value) &&
  (value as number) >= 1 &&
  (value as number) <= MAX_TIMEOUT_SECS

interface SettingsState {
  /** False until the first read finishes; nothing below is meaningful before that. */
  loaded: boolean
  presets: ProviderPreset[]
  defaults: SessionDefaults
  /** Longest silence allowed from the provider during a reply, in seconds. */
  timeoutSecs: number
  /** The session to reopen on launch. */
  lastSessionId: string | null
}

/** The single source of truth for persisted settings. Actions below update it and save. */
export const useSettingsStore = create<SettingsState>(() => ({
  loaded: false,
  presets: [],
  defaults: { providerId: null, effort: "off", model: "", systemPrompt: "" },
  timeoutSecs: DEFAULT_TIMEOUT_SECS,
  lastSessionId: null,
}))

const set = useSettingsStore.setState
const get = useSettingsStore.getState
const str = (value: unknown) => (typeof value === "string" ? value : "")

let loading: Promise<void> | null = null

/** Reads settings once; later calls return the same promise. A failed read starts from empty. */
export function loadSettings() {
  loading ??= storage
    .getSettings()
    .catch((cause) => {
      console.error("Could not read settings", cause)
      return {} as Record<string, unknown>
    })
    .then((saved) => {
      const presets = migrate(saved[SETTING_PRESETS], saved[SETTING_BASE_URL])
      const providerId =
        presets.find((p) => p.id === saved[SETTING_ACTIVE_ID])?.id ??
        presets[0]?.id ??
        null
      set({
        loaded: true,
        presets,
        defaults: {
          providerId,
          effort:
            efforts.find((e) => e === saved[SETTING_DEFAULT_EFFORT]) ?? "off",
          model: str(saved[SETTING_DEFAULT_MODEL]),
          systemPrompt: str(saved[SETTING_DEFAULT_PROMPT]),
        },
        timeoutSecs: isTimeoutSecs(saved[SETTING_TIMEOUT])
          ? saved[SETTING_TIMEOUT]
          : DEFAULT_TIMEOUT_SECS,
        lastSessionId: str(saved[SETTING_LAST_SESSION]) || null,
      })
      // A migrated legacy URL gets its generated id saved right away,
      // because the API key is stored under that id.
      if (!Array.isArray(saved[SETTING_PRESETS]) && presets.length > 0) {
        settingsWriter.set(SETTING_PRESETS, presets)
        settingsWriter.set(SETTING_ACTIVE_ID, providerId)
      }
    })
  return loading
}

/** `debounced` is for names typed key by key. */
export function setPresets(presets: ProviderPreset[], debounced = false) {
  set({ presets })
  if (debounced) settingsWriter.setDebounced(SETTING_PRESETS, presets)
  else settingsWriter.set(SETTING_PRESETS, presets)
}

export function setDefaults(patch: Partial<SessionDefaults>) {
  const prev = get().defaults
  const next = { ...prev, ...patch }
  set({ defaults: next })
  if (next.providerId !== prev.providerId)
    settingsWriter.set(SETTING_ACTIVE_ID, next.providerId)
  if (next.effort !== prev.effort)
    settingsWriter.set(SETTING_DEFAULT_EFFORT, next.effort)
  if (next.model !== prev.model)
    settingsWriter.set(SETTING_DEFAULT_MODEL, next.model)
  // Typed key by key, so saved once typing pauses.
  if (next.systemPrompt !== prev.systemPrompt)
    settingsWriter.setDebounced(SETTING_DEFAULT_PROMPT, next.systemPrompt)
}

export function setTimeoutSecs(timeoutSecs: number) {
  set({ timeoutSecs })
  settingsWriter.setDebounced(SETTING_TIMEOUT, timeoutSecs)
}

export function setLastSessionId(id: string | null) {
  set({ lastSessionId: id })
  settingsWriter.set(SETTING_LAST_SESSION, id)
}
