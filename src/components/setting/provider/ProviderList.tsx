import {
  ChevronDownIcon,
  CircleAlertIcon,
  KeyRoundIcon,
  LoaderCircleIcon,
  PlusIcon,
} from "lucide-react"
import { Button } from "@/src/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/src/components/ui/dropdown-menu"
import { providerTemplates } from "@/src/lib/providerPresets"
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
  /** Without a template, a blank preset is added. */
  onAdd: (template?: Omit<ProviderPreset, "id">) => void
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <PlusIcon />
            Add provider
            <ChevronDownIcon data-icon="inline-end" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-56">
          <DropdownMenuLabel>Local</DropdownMenuLabel>
          {providerTemplates
            .filter((t) => t.local)
            .map((template) => (
              <TemplateItem
                key={template.name}
                template={template}
                onAdd={onAdd}
              />
            ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Cloud</DropdownMenuLabel>
          {providerTemplates
            .filter((t) => !t.local)
            .map((template) => (
              <TemplateItem
                key={template.name}
                template={template}
                onAdd={onAdd}
              />
            ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onAdd()}>
            Custom endpoint…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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

function TemplateItem({
  template,
  onAdd,
}: {
  template: (typeof providerTemplates)[number]
  onAdd: (template: Omit<ProviderPreset, "id">) => void
}) {
  return (
    <DropdownMenuItem
      className="flex-col items-start gap-0"
      onSelect={() => onAdd({ name: template.name, baseUrl: template.baseUrl })}
    >
      <span>{template.name}</span>
      <span className="text-xs text-muted-foreground">{template.baseUrl}</span>
    </DropdownMenuItem>
  )
}
