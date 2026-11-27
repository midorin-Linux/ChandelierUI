import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/src/components/ui/field"
import {
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/src/components/ui/dialog"
import { Button } from "@/src/components/ui/button"
import { ScrollArea } from "@/src/components/ui/scroll-area"
import { SettingsIcon } from "lucide-react"
import { ModelBrowser } from "@/src/components/ModelBrowser"
import { EffortPicker } from "@/src/components/EffortPicker"
import { Textarea } from "@/src/components/ui/textarea"
import { useSettingsStore } from "@/src/stores/settings"
import {
  selectModel,
  setEffort,
  setSystemPrompt,
  useChatContext,
  useSession,
} from "@/src/stores/chat"

export function ModelSetting({
  onOpenProviderSettings,
}: {
  onOpenProviderSettings: () => void
}) {
  const {
    providerId,
    providerName,
    models,
    modelsLoading,
    modelsStatus,
    selectedModel,
  } = useChatContext()
  const presets = useSettingsStore((s) => s.presets)
  const selectedEffort = useSession((s) => s.data.reasoning_effort)
  const systemPrompt = useSession((s) => s.data.system_prompt)
  return (
    <DialogContent className="flex aspect-16/10 w-[min(80rem,calc(100%-2rem),calc((100dvh-2rem)*16/10))] flex-col overflow-hidden sm:max-w-none">
      <header className="border-b px-4 py-4 pr-14">
        <DialogTitle className="text-lg font-semibold">
          Select model
        </DialogTitle>
      </header>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <section
          aria-label="Models"
          className="flex w-2/5 min-h-0 min-w-0 flex-col gap-2 border-r py-3 pr-3 pl-1"
        >
          <ModelBrowser
            className="flex-1"
            presets={presets}
            selected={providerId ? { providerId, model: selectedModel } : null}
            onSelect={selectModel}
            focusSearch
          />
          {(presets.length === 0 || !modelsLoading) && models.length === 0 && (
            <p role="status" className="px-1 text-sm text-muted-foreground">
              {modelsStatus}
            </p>
          )}
          <DialogClose asChild>
            <Button
              variant={presets.length === 0 ? "default" : "outline"}
              size="sm"
              onClick={onOpenProviderSettings}
            >
              <SettingsIcon />
              Manage providers
            </Button>
          </DialogClose>
        </section>
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="px-4 pt-2"></div>
          <div className="flex min-h-0 flex-1 flex-col justify-between">
            <ScrollArea className="min-h-0 flex-1">
              <Field className="pl-4">
                <FieldSet>
                  <FieldLegend className="flex flex-col gap-0.5">
                    <span className="truncate">
                      {selectedModel || "Select a model"}
                    </span>
                    {providerName && (
                      <span className="text-xs font-normal text-muted-foreground">
                        {providerName}
                      </span>
                    )}
                  </FieldLegend>
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="system-prompt">
                        System prompt
                      </FieldLabel>
                      <Textarea
                        id="system-prompt"
                        placeholder="You are a helpful assistant."
                        value={systemPrompt}
                        onChange={(event) =>
                          setSystemPrompt(event.target.value)
                        }
                      />
                    </Field>
                  </FieldGroup>
                </FieldSet>
              </Field>
            </ScrollArea>
            <div className="shrink-0 px-4 py-4 border-t">
              <span
                id="effort-label"
                className="mb-2 block text-sm font-medium"
              >
                Effort
              </span>
              <EffortPicker
                value={selectedEffort}
                onChange={setEffort}
                labelledBy="effort-label"
                hintId="effort-hint"
              />
            </div>
          </div>
        </section>
      </div>
    </DialogContent>
  )
}
