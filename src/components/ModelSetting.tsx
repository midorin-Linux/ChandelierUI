import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/src/components/ui/field"
import { DialogContent, DialogTitle } from "@/src/components/ui/dialog"
import { Button } from "@/src/components/ui/button"
import { ScrollArea } from "@/src/components/ui/scroll-area"
import { Slider } from "@/src/components/ui/slider"
import { Textarea } from "@/src/components/ui/textarea"
import { efforts } from "@/src/types/chat"
import type { ApiModel, Effort } from "@/src/types/chat"

export interface ModelSettingProps {
  models: ApiModel[]
  modelsLoading: boolean
  modelsStatus: string
  onRefreshModels: () => void
  selectedModel: string
  onModelChange: (model: string) => void
  selectedEffort: Effort
  onEffortChange: (effort: Effort) => void
  systemPrompt: string
  onSystemPromptChange: (prompt: string) => void
}

export function ModelSetting({
  models,
  modelsLoading,
  modelsStatus,
  onRefreshModels,
  selectedModel,
  onModelChange,
  selectedEffort,
  onEffortChange,
  systemPrompt,
  onSystemPromptChange,
}: ModelSettingProps) {
  return (
    <DialogContent className="flex aspect-4/3 w-[min(64rem,calc(100%-2rem),calc((100dvh-2rem)*4/3))] flex-col overflow-hidden sm:max-w-none">
      <header className="border-b px-4 py-4 pr-14">
        <DialogTitle className="text-lg font-semibold">
          Select model
        </DialogTitle>
      </header>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <section className="flex w-1/3 min-h-0 min-w-0 flex-col border-r p-2">
          <h2 className="px-2 py-1 text-sm font-medium">Models</h2>
          <p role="status" className="px-2 py-1 text-sm text-muted-foreground">
            {modelsStatus}
          </p>
          <Button
            variant="outline"
            className="my-2"
            disabled={modelsLoading}
            onClick={onRefreshModels}
          >
            Refresh models
          </Button>
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-1 pr-3">
              {models.map((model) => (
                <Button
                  key={model.id}
                  variant={selectedModel === model.id ? "secondary" : "ghost"}
                  className="h-auto w-full shrink-0 flex-col items-start justify-start gap-1 py-2 whitespace-normal text-left"
                  aria-pressed={selectedModel === model.id}
                  onClick={() => onModelChange(model.id)}
                >
                  <span className="w-full truncate">{model.id}</span>
                </Button>
              ))}
            </div>
          </ScrollArea>
        </section>
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="px-4 pt-2"></div>
          <div className="flex min-h-0 flex-1 flex-col justify-between">
            <ScrollArea className="min-h-0 flex-1">
              <Field className="px-4">
                <FieldSet>
                  <FieldLegend>{selectedModel || "Select a model"}</FieldLegend>
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
                          onSystemPromptChange(event.target.value)
                        }
                      />
                    </Field>
                  </FieldGroup>
                </FieldSet>
              </Field>
            </ScrollArea>
            <div className="shrink-0 px-4 py-4 border-t">
              <span id="effort-label" className="text-sm font-medium">
                Effort: {selectedEffort}
              </span>
              <div
                className="flex justify-between text-xs text-muted-foreground"
                aria-hidden="true"
              >
                {efforts.map((effort) => (
                  <span key={effort}>{effort}</span>
                ))}
              </div>
              <Slider
                className="my-2"
                aria-labelledby="effort-label"
                aria-valuetext={selectedEffort}
                value={[efforts.indexOf(selectedEffort)]}
                onValueChange={([index]) => onEffortChange(efforts[index])}
                min={0}
                max={efforts.length - 1}
                step={1}
              />
              <p className="text-xs text-muted-foreground">
                Sent as reasoning_effort; off maps to none and max to xhigh.
              </p>
            </div>
          </div>
        </section>
      </div>
    </DialogContent>
  )
}
