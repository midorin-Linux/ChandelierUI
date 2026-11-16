import type { KeyboardEvent } from "react"
import { Play, RotateCcw } from "lucide-react"
import { Button } from "@/src/components/ui/button"
import { Field, FieldLabel } from "@/src/components/ui/field"
import { Input } from "@/src/components/ui/input"
import { isSubmitEnter } from "@/src/lib/utils"
import type { ApiModel } from "@/src/types/chat"

export interface ProviderSettingsProps {
  providerUrl: string
  setProviderUrl: (url: string) => void
  providerUrlInput: string
  setProviderUrlInput: (url: string) => void
  apiKey: string
  setApiKey: (key: string) => void
  models: readonly ApiModel[]
  modelsLoading: boolean
  modelsStatus: string
  onRefreshModels: () => void
}

export function ProviderSettings({
  providerUrl,
  setProviderUrl,
  providerUrlInput,
  setProviderUrlInput,
  apiKey,
  setApiKey,
  models,
  modelsLoading,
  modelsStatus,
  onRefreshModels,
}: ProviderSettingsProps) {
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
    <div className="flex flex-col gap-4">
      <p id="provider-description" className="text-sm text-muted-foreground">
        Connect to an OpenAI-compatible endpoint in the Tauri desktop app. API
        keys are optional for local endpoints. Models are fetched from your
        endpoint.
      </p>
      <Field>
        <FieldLabel htmlFor="provider-url">Base URL</FieldLabel>
        <Input
          id="provider-url"
          type="url"
          placeholder="http://localhost:1234/v1"
          value={providerUrlInput}
          onChange={(event) => setProviderUrlInput(event.target.value)}
          onKeyDown={handleKeyDown}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="provider-api-key">API Key</FieldLabel>
        <Input
          id="provider-api-key"
          type="password"
          autoComplete="off"
          placeholder="Optional"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          onKeyDown={handleKeyDown}
        />
      </Field>
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
