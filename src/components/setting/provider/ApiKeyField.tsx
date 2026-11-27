import { useCallback, useState } from "react"
import { Button } from "@/src/components/ui/button"
import { Field, FieldLabel } from "@/src/components/ui/field"
import { Input } from "@/src/components/ui/input"
import { deleteApiKey, setApiKey } from "@/src/lib/api"
import { errorMessage, isSubmitEnter } from "@/src/lib/utils"
import { markApiKey, useHasApiKey } from "@/src/stores/apiKeys"

/** Never shows the stored key: it only reports whether one is saved. Keyed by provider id. */
export function ApiKeyField({
  providerId,
  onChanged,
}: {
  providerId: string
  onChanged: () => void
}) {
  const [input, setInput] = useState("")
  const [error, setError] = useState<string | null>(null)
  const onCheckFailed = useCallback(
    (cause: unknown) => setError(errorMessage(cause)),
    []
  )
  const hasKey = useHasApiKey(providerId, onCheckFailed)

  async function run(command: () => Promise<void>, saved: boolean) {
    setError(null)
    try {
      await command()
      markApiKey(providerId, saved)
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
