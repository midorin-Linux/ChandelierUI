import { useState } from "react"
import { Field, FieldGroup } from "@/src/components/ui/field.tsx"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/src/components/ui/input-group.tsx"
import { Dialog, DialogTrigger } from "@/src/components/ui/dialog"
import { Button } from "@/src/components/ui/button.tsx"
import { ModelSetting } from "@/src/components/ModelSetting"
import type { ApiModel, Effort } from "@/src/types/chat"

export function MessageBox({
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
  onSend,
  isPending,
}: {
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
  onSend: (content: string) => boolean
  isPending: boolean
}) {
  const [draft, setDraft] = useState("")
  function sendMessage() {
    if (isPending || !draft.trim()) return
    if (onSend(draft)) setDraft("")
  }

  return (
    <div className="w-full shrink-0 p-4">
      <FieldGroup>
        <Field className="flex flex-col gap-1">
          <div className="flex min-w-0">
            <Dialog>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  className="min-w-0 max-w-full text-sm"
                >
                  <span className="truncate">
                    [{selectedEffort}] {selectedModel || "Select a model"}
                  </span>
                </Button>
              </DialogTrigger>
              <ModelSetting
                models={models}
                modelsLoading={modelsLoading}
                modelsStatus={modelsStatus}
                onRefreshModels={onRefreshModels}
                selectedModel={selectedModel}
                onModelChange={onModelChange}
                selectedEffort={selectedEffort}
                onEffortChange={onEffortChange}
                systemPrompt={systemPrompt}
                onSystemPromptChange={onSystemPromptChange}
              />
            </Dialog>
          </div>
          <InputGroup>
            <InputGroupTextarea
              placeholder={"Type a message..."}
              className="p-3"
              aria-label="Message"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing &&
                  event.keyCode !== 229
                ) {
                  event.preventDefault()
                  sendMessage()
                }
              }}
            />
            <InputGroupAddon
              align="block-end"
              className="flex items-center justify-between px-4"
            >
              <div></div>
              <div>
                <InputGroupButton
                  variant="default"
                  size="sm"
                  disabled={isPending || !draft.trim()}
                  onClick={sendMessage}
                >
                  {isPending ? "Sending…" : "Send"}
                </InputGroupButton>
              </div>
            </InputGroupAddon>
          </InputGroup>
        </Field>
      </FieldGroup>
    </div>
  )
}
