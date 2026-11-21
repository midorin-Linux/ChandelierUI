import { useCallback, useEffect, useState, type KeyboardEvent } from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { Play, Plus, RotateCcw, Trash2 } from "lucide-react"
import { Button } from "@/src/components/ui/button"
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/src/components/ui/combobox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog"
import { Field, FieldLabel } from "@/src/components/ui/field"
import { Input } from "@/src/components/ui/input"
import { errorMessage, isSubmitEnter } from "@/src/lib/utils"
import type { ApiModel, ProviderPreset } from "@/src/types/chat"

export interface ProviderSettingsProps {
  presets: ProviderPreset[]
  activeId: string | null
  onSelectPreset: (id: string) => void
  onAddPreset: () => void
  /** Rejects, keeping the preset, when its key cannot be deleted. */
  onRemovePreset: () => Promise<void>
  onRenamePreset: (name: string) => void
  providerUrl: string
  setProviderUrl: (url: string) => void
  providerUrlInput: string
  setProviderUrlInput: (url: string) => void
  models: readonly ApiModel[]
  modelsLoading: boolean
  modelsStatus: string
  onRefreshModels: () => void
}

/** `has_api_key` results per provider id, so opening settings doesn't hit the keyring each time. */
const savedKeys = new Map<string, boolean>()

/** Display name; an emptied name is kept as is but shown as "Untitled". */
const label = (preset: ProviderPreset) => preset.name.trim() || "Untitled"

/** Never shows the stored key: it only reports whether one is saved. Keyed by provider id. */
function ApiKeyField({
  providerId,
  onChanged,
}: {
  providerId: string
  onChanged: () => void
}) {
  const [hasKey, setHasKey] = useState<boolean | null>(
    isTauri() ? (savedKeys.get(providerId) ?? null) : false
  )
  const [input, setInput] = useState("")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isTauri() || savedKeys.has(providerId)) return
    let stale = false
    invoke<boolean>("has_api_key", { providerId })
      .then((saved) => {
        savedKeys.set(providerId, saved)
        if (!stale) setHasKey(saved)
      })
      .catch((cause) => !stale && setError(errorMessage(cause)))
    return () => {
      stale = true
    }
  }, [providerId])

  async function run(command: string, args: object, saved: boolean) {
    setError(null)
    try {
      if (!isTauri())
        throw new Error("Saving keys requires the Tauri desktop app.")
      await invoke(command, { providerId, ...args })
      savedKeys.set(providerId, saved)
      setHasKey(saved)
      setInput("")
      onChanged()
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  const save = () => {
    if (input.trim()) void run("set_api_key", { key: input.trim() }, true)
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
          onClick={() => void run("delete_api_key", {}, false)}
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

export function ProviderSettings({
  presets,
  activeId,
  onSelectPreset,
  onAddPreset,
  onRemovePreset,
  onRenamePreset,
  providerUrl,
  setProviderUrl,
  providerUrlInput,
  setProviderUrlInput,
  models,
  modelsLoading,
  modelsStatus,
  onRefreshModels,
}: ProviderSettingsProps) {
  const active = presets.find((p) => p.id === activeId) ?? null
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  // A body-level portal counts as outside the Radix dialog, so clicks never select.
  const [dialog, setDialog] = useState<HTMLElement | null>(null)
  const dialogRef = useCallback(
    (node: HTMLElement | null) =>
      setDialog(
        node?.closest<HTMLElement>("[data-slot=dialog-content]") ?? null
      ),
    []
  )

  async function confirmDelete() {
    if (deleting) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await onRemovePreset()
      setConfirmingDelete(false)
    } catch (cause) {
      setDeleteError(errorMessage(cause))
    } finally {
      setDeleting(false)
    }
  }

  function refreshModels() {
    const url = providerUrlInput.trim()
    if (url === providerUrl) onRefreshModels()
    else setProviderUrl(url)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!isSubmitEnter(event)) return
    event.preventDefault()
    refreshModels()
  }

  return (
    <div ref={dialogRef} className="flex flex-col gap-4">
      <p id="provider-description" className="text-sm text-muted-foreground">
        Connect to an OpenAI-compatible endpoint in the Tauri desktop app. API
        keys are optional for local endpoints. Models are fetched from your
        endpoint.
      </p>
      <Field>
        <FieldLabel>Provider</FieldLabel>
        <div className="flex gap-2">
          <Combobox
            items={presets}
            value={active}
            itemToStringLabel={label}
            isItemEqualToValue={(a: ProviderPreset, b: ProviderPreset) =>
              a.id === b.id
            }
            onValueChange={(preset) => preset && onSelectPreset(preset.id)}
          >
            <ComboboxInput placeholder="No provider" className="w-full" />
            <ComboboxContent container={dialog}>
              <ComboboxList>
                {(preset: ProviderPreset) => (
                  <ComboboxItem key={preset.id} value={preset}>
                    {label(preset)}
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
          <Button
            size="icon"
            variant="outline"
            aria-label="Add provider"
            onClick={onAddPreset}
          >
            <Plus />
          </Button>
          <Button
            size="icon"
            variant="outline"
            aria-label="Delete provider"
            disabled={!active || deleting}
            onClick={() => {
              setDeleteError(null)
              setConfirmingDelete(true)
            }}
          >
            <Trash2 />
          </Button>
        </div>
      </Field>
      <Dialog
        open={confirmingDelete}
        onOpenChange={(open) => !deleting && setConfirmingDelete(open)}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete provider</DialogTitle>
            <DialogDescription>
              Delete the provider &quot;{active && label(active)}&quot;? Its
              saved API key is also removed from the system keyring.
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <p role="alert" className="text-sm text-destructive">
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
      {active && (
        <>
          <Field>
            <FieldLabel htmlFor="provider-name">Name</FieldLabel>
            <Input
              id="provider-name"
              value={active.name}
              onChange={(event) => onRenamePreset(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="provider-url">Base URL</FieldLabel>
            <Input
              id="provider-url"
              type="url"
              placeholder="http://localhost:1234/v1"
              value={providerUrlInput}
              onChange={(event) => setProviderUrlInput(event.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={() => {
                const url = providerUrlInput.trim()
                if (url !== providerUrl) setProviderUrl(url)
              }}
            />
          </Field>
          <ApiKeyField
            key={active.id}
            providerId={active.id}
            onChanged={onRefreshModels}
          />
        </>
      )}
      <Field>
        <div className="flex items-center justify-between">
          <div className="flex gap-2 items-center">
            <FieldLabel>Models</FieldLabel>
            <p role="status" className="text-sm text-muted-foreground">
              {modelsStatus}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="default"
              aria-label="Refresh models"
              disabled={modelsLoading}
              onClick={refreshModels}
            >
              <Play />
              <span>Fetch</span>
            </Button>
            <Button
              size="icon-sm"
              variant="outline"
              aria-label="Refresh models"
              disabled={modelsLoading}
              onClick={refreshModels}
            >
              <RotateCcw />
            </Button>
          </div>
        </div>
        <ul className="flex flex-col gap-1 text-sm">
          {models.map((model) => (
            <li key={model.id} className="truncate rounded-md border px-2 py-1">
              {model.id}
            </li>
          ))}
        </ul>
      </Field>
    </div>
  )
}
