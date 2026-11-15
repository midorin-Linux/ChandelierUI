import { useState } from "react"
import { ModelSetting } from "@/src/components/ModelSetting"
import type { ModelSettingProps } from "@/src/components/ModelSetting"
import { Button } from "@/src/components/ui/button"
import { Dialog, DialogTrigger } from "@/src/components/ui/dialog"
import { Field, FieldGroup } from "@/src/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/src/components/ui/input-group"
import { isSubmitEnter } from "@/src/lib/utils"

export function MessageBox({
  onSend,
  isPending,
  ...settings
}: ModelSettingProps & {
  onSend: (content: string) => boolean
  isPending: boolean
}) {
  const { selectedEffort, selectedModel } = settings
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
              <ModelSetting {...settings} />
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
                if (isSubmitEnter(event) && !event.shiftKey) {
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
