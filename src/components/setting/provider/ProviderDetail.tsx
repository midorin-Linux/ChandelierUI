import { useEffect, useRef, useState } from "react"
import {
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  EllipsisIcon,
  LoaderCircleIcon,
  Trash2Icon,
} from "lucide-react"
import { ModelBrowser } from "@/src/components/ModelBrowser"
import { Button } from "@/src/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/src/components/ui/collapsible"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/src/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/src/components/ui/field"
import { Input } from "@/src/components/ui/input"
import { providerModelsView } from "@/src/lib/models"
import { cn, errorMessage, isSubmitEnter } from "@/src/lib/utils"
import {
  presetLabel as label,
  refreshModels,
  removePreset,
  renamePreset,
  setPresetUrl,
} from "@/src/stores/chat"
import { useModelsStore } from "@/src/stores/models"
import { useSettingsStore } from "@/src/stores/settings"
import type { ProviderPreset } from "@/src/types/chat"
import { ApiKeyField } from "./ApiKeyField"
import { isHttpUrl } from "@/src/lib/url"

export function ProviderDetail({
  preset,
  isNew,
}: {
  preset: ProviderPreset
  isNew: boolean
}) {
  const view = providerModelsView(useModelsStore(), preset)
  // Committed on Enter, blur and unmount, so a URL is never fetched half-typed.
  const [url, setUrl] = useState(preset.baseUrl)
  const unsaved = useRef({ url, saved: preset.baseUrl })
  useEffect(() => {
    unsaved.current = { url, saved: preset.baseUrl }
  })
  useEffect(
    () => () => {
      const { url, saved } = unsaved.current
      // Closing the dialog (e.g. Escape) unmounts the field without a blur.
      const exists = useSettingsStore
        .getState()
        .presets.some((p) => p.id === preset.id)
      if (exists && url.trim() !== saved) setPresetUrl(preset.id, url.trim())
    },
    [preset.id]
  )
  const commitUrl = () => {
    if (url.trim() !== preset.baseUrl) setPresetUrl(preset.id, url.trim())
  }
  const invalidUrl = url.trim() !== "" && !isHttpUrl(url.trim())
  // Connects once typing pauses, so no Enter is needed; a half-typed URL that
  // already parses may be fetched once, which is harmless.
  useEffect(() => {
    const next = url.trim()
    if (next === preset.baseUrl || (next && !isHttpUrl(next))) return
    const timer = setTimeout(() => setPresetUrl(preset.id, next), 800)
    return () => clearTimeout(timer)
  }, [url, preset.id, preset.baseUrl])

  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function confirmDelete() {
    if (deleting) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await removePreset(preset.id)
      // This component unmounts with the preset; nothing to reset.
    } catch (cause) {
      setDeleteError(errorMessage(cause))
      setDeleting(false)
    }
  }

  const committed = url.trim() === preset.baseUrl.trim()
  const connection =
    !preset.baseUrl.trim() || !committed ? null : view.loading ? (
      <span className="flex items-center gap-1">
        <LoaderCircleIcon className="size-3.5 animate-spin" /> Connecting…
      </span>
    ) : view.error ? (
      <span className="flex items-start gap-1 text-destructive">
        <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
        <span className="break-words">{view.error}</span>
      </span>
    ) : (
      <span className="flex items-center gap-1">
        <CircleCheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" />
        Connected · {view.models.length} models
      </span>
    )

  return (
    <section
      aria-label={`${label(preset)} settings`}
      className="flex min-w-0 flex-1 flex-col gap-5"
    >
      <Field>
        <FieldLabel htmlFor="provider-name">Name</FieldLabel>
        <div className="flex gap-2">
          <Input
            id="provider-name"
            value={preset.name}
            // eslint-disable-next-line jsx-a11y/no-autofocus -- a new provider is named first
            autoFocus={isNew}
            onFocus={(event) => isNew && event.target.select()}
            placeholder="Untitled"
            aria-describedby={
              preset.name.trim() ? undefined : "provider-name-hint"
            }
            onChange={(event) => renamePreset(preset.id, event.target.value)}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="More actions">
                <EllipsisIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => {
                  setDeleteError(null)
                  setConfirmingDelete(true)
                }}
              >
                <Trash2Icon />
                Delete provider…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {!preset.name.trim() && (
          <FieldDescription id="provider-name-hint">
            Without a name this provider is shown as &quot;Untitled&quot;.
          </FieldDescription>
        )}
      </Field>
      <Field>
        <FieldLabel htmlFor="provider-url">Base URL</FieldLabel>
        <Input
          id="provider-url"
          type="url"
          placeholder="http://localhost:1234/v1"
          aria-invalid={invalidUrl || undefined}
          aria-describedby="provider-url-status"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (!isSubmitEnter(event)) return
            event.preventDefault()
            if (committed) refreshModels(preset.id)
            else commitUrl()
          }}
          onBlur={commitUrl}
        />
        <FieldDescription id="provider-url-status" role="status">
          {invalidUrl
            ? "Enter a URL starting with http:// or https://."
            : !committed
              ? "Connects when you stop typing."
              : (connection ??
                "The endpoint's /models list is loaded once a URL is entered.")}
        </FieldDescription>
      </Field>
      <ApiKeyField
        providerId={preset.id}
        onChanged={() => refreshModels(preset.id)}
      />
      {/* Only a reference: models are picked in the chat's model dialog. */}
      <Collapsible className="flex min-h-0 flex-col gap-2">
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="w-fit px-1 [&_svg]:transition-transform data-[state=open]:[&_svg]:rotate-90"
          >
            <ChevronRightIcon />
            Models{view.models.length > 0 && ` (${view.models.length})`}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ModelBrowser
            className="max-h-96"
            presets={[preset]}
            groupTitle={() => "Available models"}
            errorShownElsewhere
          />
        </CollapsibleContent>
      </Collapsible>
      <Dialog
        open={confirmingDelete}
        onOpenChange={(open) => !deleting && setConfirmingDelete(open)}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete provider</DialogTitle>
            <DialogDescription>
              Delete the provider &quot;{label(preset)}&quot;? Its saved API key
              is also removed from the system keyring. Chats that use it switch
              to the default provider.
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <p role="alert" className={cn("text-sm text-destructive")}>
              {deleteError}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={deleting}
              onClick={() => setConfirmingDelete(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={() => void confirmDelete()}
            >
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
