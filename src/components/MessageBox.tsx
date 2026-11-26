import { useState } from "react"
import { ModelSetting } from "@/src/components/ModelSetting"
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
import {
  cancelCompletion,
  sendMessage as send,
  useBusy,
  useChatContext,
  useChatStore,
  useSession,
} from "@/src/stores/chat"

export function MessageBox({
  onOpenProviderSettings,
}: {
  onOpenProviderSettings: () => void
}) {
  const { selectedModel } = useChatContext()
  const selectedEffort = useSession((s) => s.data.reasoning_effort)
  const isPending = useChatStore((s) => s.stream.isPending)
  // Switching or restoring a session: sending is off but the draft is kept.
  const disabled = useBusy()
  const [draft, setDraft] = useState("")
  function sendMessage() {
    if (isPending || disabled || !draft.trim()) return
    if (send(draft)) setDraft("")
  }

  return (
    <div className="w-full shrink-0 bg-background pb-4">
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
              <ModelSetting onOpenProviderSettings={onOpenProviderSettings} />
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
                {isPending ? (
                  <InputGroupButton
                    variant="destructive"
                    size="sm"
                    onClick={() => void cancelCompletion()}
                  >
                    Cancel
                  </InputGroupButton>
                ) : (
                  <InputGroupButton
                    variant="default"
                    size="sm"
                    disabled={disabled || !draft.trim()}
                    onClick={sendMessage}
                  >
                    Send
                  </InputGroupButton>
                )}
              </div>
            </InputGroupAddon>
          </InputGroup>
        </Field>
      </FieldGroup>
    </div>
  )
}
