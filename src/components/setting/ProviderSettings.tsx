import { useState } from "react"
import { addPreset, useChatContext } from "@/src/stores/chat"
import { useSettingsStore } from "@/src/stores/settings"
import { ProviderDetail } from "./provider/ProviderDetail"
import { ProviderList } from "./provider/ProviderList"

/**
 * Presets on the left, the one being edited on the right. Choosing a preset
 * here only picks what to edit: a chat's provider is chosen with its model.
 */
export function ProviderSettings() {
  const presets = useSettingsStore((s) => s.presets)
  const defaults = useSettingsStore((s) => s.defaults)
  const { providerId: chatProviderId } = useChatContext()
  const [editingId, setEditingId] = useState(
    () => chatProviderId ?? presets[0]?.id ?? null
  )
  const [addedId, setAddedId] = useState<string | null>(null)
  // A deleted preset falls back to the first one.
  const editing = presets.find((p) => p.id === editingId) ?? presets[0] ?? null

  return (
    <div className="flex min-h-0 flex-col gap-6 md:flex-row">
      <ProviderList
        presets={presets}
        editingId={editing?.id ?? null}
        inUseId={chatProviderId}
        defaultId={defaults.model ? defaults.providerId : null}
        onEdit={setEditingId}
        onAdd={(template) => {
          const id = addPreset(template)
          setEditingId(id)
          setAddedId(id)
        }}
      />
      {editing ? (
        <ProviderDetail
          key={editing.id}
          preset={editing}
          isNew={editing.id === addedId}
        />
      ) : (
        <p className="flex-1 text-sm text-muted-foreground">
          No providers yet. Add one to start chatting.
        </p>
      )}
    </div>
  )
}
