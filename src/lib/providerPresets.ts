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
