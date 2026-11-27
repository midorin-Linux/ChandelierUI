import { useEffect, useRef, useState } from "react"
import {
  CircleAlertIcon,
  CircleCheckIcon,
  LoaderCircleIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"
import { ModelBrowser } from "@/src/components/ModelBrowser"
import { Button } from "@/src/components/ui/button"
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
import { deleteApiKey, desktop, hasApiKey, setApiKey } from "@/src/lib/api"
import { errorMessage, isSubmitEnter } from "@/src/lib/utils"
import { providerModelsView } from "@/src/lib/models"
import { cn } from "@/src/lib/utils"
import {
  addPreset,
  presetLabel as label,
  refreshModels,
  removePreset,
  renamePreset,
  setPresetUrl,
  useChatContext,
} from "@/src/stores/chat"
import { useModelsStore } from "@/src/stores/models"
import { useSettingsStore } from "@/src/stores/settings"
import type { ProviderPreset } from "@/src/types/chat"

/** `has_api_key` results per provider id, so opening settings doesn't hit the keyring each time. */
const savedKeys = new Map<string, boolean>()

/** Never shows the stored key: it only reports whether one is saved. Keyed by provider id. */
function ApiKeyField({
  providerId,
  onChanged,
}: {
  providerId: string
  onChanged: () => void
}) {
  const [hasKey, setHasKey] = useState<boolean | null>(
    desktop ? (savedKeys.get(providerId) ?? null) : false
  )
  const [input, setInput] = useState("")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!desktop || savedKeys.has(providerId)) return
    let stale = false
    hasApiKey(providerId)
      .then((saved) => {
        savedKeys.set(providerId, saved)
        if (!stale) setHasKey(saved)
      })
      .catch((cause) => !stale && setError(errorMessage(cause)))
    return () => {
      stale = true
    }
  }, [providerId])

  async function run(command: () => Promise<void>, saved: boolean) {
    setError(null)
    try {
      await command()
      savedKeys.set(providerId, saved)
      setHasKey(saved)
      setInput("")
      onChanged()
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  const save = () => {
    if (input.trim()) void run(() => setApiKey(providerId, input.trim()), true)
  }

  return (
    <Field>
      <FieldLabel htmlFor="provider-api-key">API Key</FieldLabel>
      <div className="flex gap-2">
        <Input
          id="provider-api-key"
          type="password"
          autoComplete="off"
          placeholder={
            hasKey ? "Saved. Enter a new key to replace it" : "Optional"
          }
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (!isSubmitEnter(event)) return
            event.preventDefault()
            save()
          }}
        />
        <Button disabled={!input.trim()} onClick={save}>
          Save
        </Button>
        <Button
          variant="outline"
          disabled={!hasKey}
          onClick={() => void run(() => deleteApiKey(providerId), false)}
        >
          Delete
        </Button>
      </div>
      <p role="status" className="text-sm text-muted-foreground">
        {error ??
          (hasKey === null
            ? "Checking…"
            : hasKey
              ? "A key is saved in the system keyring."
              : "No key saved.")}
      </p>
    </Field>
  )
}

/** The host to tell presets apart in the list; the raw text if it is not a URL. */
function host(url: string) {
  try {
    return new URL(url).host
  } catch {
    return url.trim()
  }
}

const isHttpUrl = (url: string) => {
  try {
    return ["http:", "https:"].includes(new URL(url).protocol)
  } catch {
    return false
  }
}

function Badge({ children }: { children: string }) {
  return (
    <span className="rounded-sm bg-muted px-1 py-px text-[0.65rem] leading-tight font-medium text-muted-foreground uppercase">
      {children}
    </span>
  )
}

/**
 * Presets on the left, the one being edited on the right. Choosing a preset
 * here only picks what to edit: a chat's provider is chosen with its model.
 */
export function ProviderSettings() {
  const presets = useSettingsStore((s) => s.presets)
  const defaults = useSettingsStore((s) => s.defaults)
  const { providerId: chatProviderId } = useChatContext()
  const lists = useModelsStore()
  const [editingId, setEditingId] = useState(
    () => chatProviderId ?? presets[0]?.id ?? null
  )
  const [addedId, setAddedId] = useState<string | null>(null)
  // A deleted preset falls back to the first one.
  const editing = presets.find((p) => p.id === editingId) ?? presets[0] ?? null
  const defaultModelProvider = defaults.model ? defaults.providerId : null

  return (
    <div className="flex min-h-0 flex-col gap-6 md:flex-row">
      <nav
        aria-label="Providers"
        className="flex shrink-0 flex-col gap-2 md:w-60"
      >
        <ul className="flex flex-col gap-1">
          {presets.map((preset) => {
            const view = providerModelsView(lists, preset)
            const current = preset.id === editing?.id
            return (
              <li key={preset.id}>
                <Button
                  variant={current ? "secondary" : "ghost"}
                  className="h-auto w-full flex-col items-stretch gap-0.5 py-2 text-left"
                  aria-current={current ? "true" : undefined}
                  onClick={() => setEditingId(preset.id)}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate">{label(preset)}</span>
                    {preset.id === chatProviderId && <Badge>In use</Badge>}
                    {preset.id === defaultModelProvider && (
                      <Badge>Default</Badge>
                    )}
                  </span>
                  <span className="flex min-w-0 items-center gap-1 text-xs font-normal text-muted-foreground">
                    {view.loading ? (
                      <LoaderCircleIcon className="size-3 animate-spin" />
                    ) : view.error ? (
                      <CircleAlertIcon className="size-3 text-destructive" />
                    ) : null}
                    <span className="truncate">
                      {preset.baseUrl.trim()
                        ? `${host(preset.baseUrl)}${
                            view.loading || view.error
                              ? ""
                              : ` · ${view.models.length} models`
                          }`
                        : "No base URL"}
                    </span>
                  </span>
                </Button>
              </li>
            )
          })}
        </ul>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const id = addPreset()
            setEditingId(id)
            setAddedId(id)
          }}
        >
          <PlusIcon />
          Add provider
        </Button>
        <p className="px-1 text-xs text-muted-foreground">
          Any OpenAI-compatible endpoint. Models from every provider are listed
          in the model picker.
        </p>
      </nav>
      {editing ? (
        <ProviderDetail
          key={editing.id}
          preset={editing}
          isNew={editing.id === addedId}
        />
      ) : (
        <div className="flex flex-1 flex-col items-start gap-2 text-sm text-muted-foreground">
          <p>No providers yet. Add one to start chatting.</p>
        </div>
      )}
    </div>
  )
}

function ProviderDetail({
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
        <Input
          id="provider-name"
          value={preset.name}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- a new provider is named first
          autoFocus={isNew}
          onFocus={(event) => isNew && event.target.select()}
          placeholder="Untitled"
          onChange={(event) => renamePreset(preset.id, event.target.value)}
        />
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
              ? "Press Enter to connect."
              : (connection ??
                "The endpoint's /models list is loaded once a URL is entered.")}
        </FieldDescription>
      </Field>
      <ApiKeyField
        providerId={preset.id}
        onChanged={() => refreshModels(preset.id)}
      />
      <div className="flex min-h-0 flex-col gap-2">
        <h3 className="text-sm font-medium">Models</h3>
        <ModelBrowser
          className="max-h-96"
          presets={[preset]}
          groupTitle={() => "Available models"}
        />
      </div>
      <div className="flex flex-col gap-2 rounded-lg border border-destructive/30 p-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium">Delete provider</h3>
            <p className="text-sm text-muted-foreground">
              Removes this provider and its saved API key.
            </p>
          </div>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              setDeleteError(null)
              setConfirmingDelete(true)
            }}
          >
            <Trash2Icon />
            Delete
          </Button>
        </div>
      </div>
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
