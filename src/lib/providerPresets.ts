import type { ProviderPreset } from "../types/chat"

/** Saved presets, or one "Default" preset made from the legacy single base URL. */
export function migrate(
  saved: unknown,
  legacyUrl: unknown,
  newId: () => string = () => crypto.randomUUID()
): ProviderPreset[] {
  if (Array.isArray(saved)) {
    return saved.filter(
      (p): p is ProviderPreset =>
        typeof p?.id === "string" &&
        typeof p.name === "string" &&
        typeof p.baseUrl === "string"
    )
  }
  return typeof legacyUrl === "string" && legacyUrl
    ? [{ id: newId(), name: "Default", baseUrl: legacyUrl }]
    : []
}

export function add(presets: ProviderPreset[], preset: ProviderPreset) {
  return [...presets, preset]
}

export function update(
  presets: ProviderPreset[],
  id: string,
  patch: Partial<Omit<ProviderPreset, "id">>
) {
  return presets.map((p) => (p.id === id ? { ...p, ...patch } : p))
}

/** Removing the active preset activates the first remaining one, or none. */
export function remove(
  presets: ProviderPreset[],
  activeId: string | null,
  id: string
) {
  const next = presets.filter((p) => p.id !== id)
  return {
    presets: next,
    activeId:
      activeId !== id && next.some((p) => p.id === activeId)
        ? activeId
        : (next[0]?.id ?? null),
  }
}

/**
 * Deletes the stored key first and drops the preset only once that succeeded,
 * so a failed key deletion never leaves a key with no preset. Rejects on failure.
 */
export async function deletePreset(
  presets: ProviderPreset[],
  activeId: string | null,
  id: string,
  deleteKey: (id: string) => Promise<void>
) {
  await deleteKey(id)
  return remove(presets, activeId, id)
}

/**
 * The preset a session talks to: its own when it still exists, otherwise
 * `fallbackId` (the new-chat default). `missing` is true only when the session
 * named a preset that has since been deleted, not for sessions saved before presets.
 */
export function sessionProvider(
  presets: ProviderPreset[],
  providerId: string | null | undefined,
  fallbackId: string | null
): { id: string | null; missing: boolean } {
  if (providerId && presets.some((p) => p.id === providerId))
    return { id: providerId, missing: false }
  return {
    id: presets.some((p) => p.id === fallbackId) ? fallbackId : null,
    missing: Boolean(providerId),
  }
}
