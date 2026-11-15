import { useState } from "react"
import { RotateCcw } from "lucide-react"
import { Button } from "@/src/components/ui/button"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/src/components/ui/combobox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/src/components/ui/dialog"
import { Field, FieldLabel } from "@/src/components/ui/field"
import { Input } from "@/src/components/ui/input"
import { isSubmitEnter } from "@/src/lib/utils"
import type { ApiModel } from "@/src/types/chat"

export function ProviderSettings({
  providerUrl,
  setProviderUrl,
  providerUrlInput,
  setProviderUrlInput,
  models,
  selectedModel,
  onModelChange,
  modelsLoading,
  modelsStatus,
  onRefreshModels,
}: {
  providerUrl: string
  setProviderUrl: (url: string) => void
  providerUrlInput: string
  setProviderUrlInput: (url: string) => void
  models: readonly ApiModel[]
  selectedModel: string
  onModelChange: (model: string) => void
  modelsLoading: boolean
  modelsStatus: string
  onRefreshModels: () => void
}) {
  const [open, setOpen] = useState(false)
  const canContinue = !modelsLoading && !!selectedModel

  function refreshModels() {
    const url = providerUrlInput.trim()
    if (!url) return
    if (url === providerUrl) onRefreshModels()
    else setProviderUrl(url)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Provider settings</Button>
      </DialogTrigger>
      <DialogContent
        aria-describedby="provider-description"
        className="sm:max-w-md"
      >
        <DialogHeader className="border-b px-4 py-4 pr-14">
          <DialogTitle className="text-lg font-semibold">
            Provider settings
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 overflow-y-auto p-4">
          <p
            id="provider-description"
            className="text-sm text-muted-foreground"
          >
            Connect to an unauthenticated local OpenAI-compatible endpoint in
            the Tauri desktop app. No API keys are supported. Models are fetched
            from your endpoint.
          </p>
          <Field>
            <FieldLabel htmlFor="provider-url">Base URL</FieldLabel>
            <Input
              id="provider-url"
              type="url"
              placeholder="http://localhost:1234/v1"
              value={providerUrlInput}
              onChange={(event) => setProviderUrlInput(event.target.value)}
              onKeyDown={(event) => {
                if (!isSubmitEnter(event)) return
                event.preventDefault()
                refreshModels()
              }}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="provider-model">Model</FieldLabel>
            <div className="flex items-stretch gap-2">
              <Combobox
                items={models.map((model) => model.id)}
                value={selectedModel || null}
                onValueChange={(value) => {
                  if (value !== null) onModelChange(value)
                }}
                disabled={modelsLoading || models.length === 0}
              >
                <ComboboxInput
                  id="provider-model"
                  className="min-w-0 flex-1"
                  placeholder="Select a model"
                />
                <ComboboxContent>
                  <ComboboxEmpty>No models found</ComboboxEmpty>
                  <ComboboxList>
                    {(model: string) => (
                      <ComboboxItem key={model} value={model}>
                        {model}
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
              <Button
                size="icon-sm"
                variant="outline"
                className="size-8! shrink-0"
                aria-label="Refresh models"
                disabled={modelsLoading}
                onClick={refreshModels}
              >
                <RotateCcw />
              </Button>
            </div>
          </Field>
          <p role="status" className="text-sm text-muted-foreground">
            {modelsStatus}
          </p>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button
              type="button"
              variant="default"
              className="w-full shrink-0"
              disabled={!canContinue}
            >
              Continue
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
