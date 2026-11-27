import {
  CircleAlertIcon,
  KeyRoundIcon,
  LoaderCircleIcon,
  PlusIcon,
} from "lucide-react"
import { Button } from "@/src/components/ui/button"
import { providerModelsView } from "@/src/lib/models"
import { presetLabel as label } from "@/src/stores/chat"
import { useHasApiKey } from "@/src/stores/apiKeys"
import { useModelsStore } from "@/src/stores/models"
import type { ProviderPreset } from "@/src/types/chat"
import { host } from "@/src/lib/url"
import { Badge } from "./Badge"

export function ProviderList({
  presets,
  editingId,
  inUseId,
  defaultId,
  onEdit,
  onAdd,
}: {
  presets: readonly ProviderPreset[]
  editingId: string | null
  /** The current chat's provider. */
  inUseId: string | null
  /** The default model's provider, if a default model is set. */
  defaultId: string | null
  onEdit: (id: string) => void
  onAdd: () => void
}) {
  return (
    <nav
      aria-label="Providers"
      className="flex shrink-0 flex-col gap-2 md:w-60"
    >
      <ul className="flex flex-col gap-1">
        {presets.map((preset) => (
          <li key={preset.id}>
            <ProviderRow
              preset={preset}
              current={preset.id === editingId}
              inUse={preset.id === inUseId}
              isDefault={preset.id === defaultId}
              onClick={() => onEdit(preset.id)}
            />
          </li>
        ))}
      </ul>
      <Button variant="outline" size="sm" onClick={onAdd}>
        <PlusIcon />
        Add provider
      </Button>
      <p className="px-1 text-xs text-muted-foreground">
        Any OpenAI-compatible endpoint. Models from every provider are listed in
        the model picker.
      </p>
    </nav>
  )
}

function ProviderRow({
  preset,
  current,
  inUse,
  isDefault,
  onClick,
}: {
  preset: ProviderPreset
  current: boolean
  inUse: boolean
  isDefault: boolean
  onClick: () => void
}) {
  const view = providerModelsView(useModelsStore(), preset)
  const hasKey = useHasApiKey(preset.id)
  const url = preset.baseUrl.trim()
  return (
    <Button
      variant={current ? "secondary" : "ghost"}
      className="h-auto w-full flex-col items-stretch gap-0.5 py-2 text-left"
      aria-current={current ? "true" : undefined}
      onClick={onClick}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate">{label(preset)}</span>
        {hasKey && (
          <KeyRoundIcon
            className="size-3 text-muted-foreground"
            aria-label="API key saved"
          />
        )}
        {inUse && <Badge>In use</Badge>}
        {isDefault && <Badge>Default</Badge>}
      </span>
      <span className="flex min-w-0 items-center gap-1 text-xs font-normal text-muted-foreground">
        {view.loading ? (
          <LoaderCircleIcon className="size-3 animate-spin" />
        ) : view.error ? (
          <CircleAlertIcon className="size-3 text-destructive" />
        ) : null}
        <span className="truncate">
          {!url
            ? "No base URL"
            : view.loading || view.error
              ? host(url)
              : `${host(url)} · ${view.models.length} models`}
        </span>
      </span>
    </Button>
  )
}
