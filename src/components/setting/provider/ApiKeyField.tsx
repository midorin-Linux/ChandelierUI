import { useCallback, useState } from "react"
import { EyeIcon, EyeOffIcon, KeyRoundIcon } from "lucide-react"
import { Button } from "@/src/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/src/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/src/components/ui/input-group"
import { deleteApiKey, desktop, setApiKey } from "@/src/lib/api"
import { errorMessage, isSubmitEnter } from "@/src/lib/utils"
import { markApiKey, useHasApiKey } from "@/src/stores/apiKeys"

/**
 * Never shows the stored key: it only reports whether one is saved. A saved key
 * is replaced through "Replace", so the empty input never looks like a lost key.
 */
export function ApiKeyField({
  providerId,
  onChanged,
}: {
  providerId: string
  onChanged: () => void
}) {
  const [input, setInput] = useState("")
  const [visible, setVisible] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const onCheckFailed = useCallback(
    (cause: unknown) => setError(errorMessage(cause)),
    []
  )
  const hasKey = useHasApiKey(providerId, onCheckFailed)

  async function run(command: () => Promise<void>, saved: boolean) {
    setError(null)
    setBusy(true)
    try {
      await command()
      markApiKey(providerId, saved)
      setInput("")
      setVisible(false)
      setEditing(false)
      setConfirmingDelete(false)
      onChanged()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const save = () => {
    if (input.trim()) void run(() => setApiKey(providerId, input.trim()), true)
  }

  const showInput = !hasKey || editing

  return (
    <Field data-invalid={error !== null || undefined}>
      <FieldLabel htmlFor={showInput ? "provider-api-key" : undefined}>
        API Key
      </FieldLabel>
      {showInput ? (
        <div className="flex gap-2">
          <InputGroup>
            <InputGroupInput
              id="provider-api-key"
              type={visible ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              placeholder={hasKey ? "New key" : "Optional for local endpoints"}
              aria-describedby="provider-api-key-status"
              disabled={!desktop || busy}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && editing) {
                  event.preventDefault()
                  event.stopPropagation()
                  setEditing(false)
                  setInput("")
                }
                if (!isSubmitEnter(event)) return
                event.preventDefault()
                save()
              }}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                aria-label={visible ? "Hide key" : "Show key"}
                aria-pressed={visible}
                onClick={() => setVisible(!visible)}
              >
                {visible ? <EyeOffIcon /> : <EyeIcon />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <Button disabled={!input.trim() || busy} onClick={save}>
            Save
          </Button>
          {editing && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setEditing(false)
                setInput("")
              }}
            >
              Cancel
            </Button>
          )}
        </div>
      ) : confirmingDelete ? (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 px-3 py-1.5 text-sm">
          <span className="flex-1">
            Remove the key from the system keyring?
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => setConfirmingDelete(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={() => void run(() => deleteApiKey(providerId), false)}
          >
            {busy ? "Removing…" : "Remove"}
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
          <KeyRoundIcon className="size-4 text-muted-foreground" />
          <span className="flex-1 tracking-widest text-muted-foreground">
            ••••••••
          </span>
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            Replace
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => setConfirmingDelete(true)}
          >
            Remove
          </Button>
        </div>
      )}
      {error ? (
        <FieldError id="provider-api-key-status">{error}</FieldError>
      ) : (
        <FieldDescription id="provider-api-key-status" role="status">
          {!desktop
            ? "API keys need the desktop app's system keyring."
            : hasKey === null
              ? "Checking…"
              : hasKey
                ? "Saved in the system keyring. It is never shown again."
                : "Stored in the system keyring, never in settings files."}
        </FieldDescription>
      )}
    </Field>
  )
}
