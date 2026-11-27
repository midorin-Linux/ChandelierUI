import { useEffect, useRef, useState } from "react"
import { ModelSetting } from "@/src/components/ModelSetting"
import { Badge } from "@/src/components/ui/badge"
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
  useActiveStream,
  useBusy,
  useChatStore,
  useChatContext,
  useSession,
} from "@/src/stores/chat"

export function MessageBox() {
  const { selectedModel, providerName } = useChatContext()
  const selectedEffort = useSession((s) => s.data.reasoning_effort)
  // Cancel shows only in the chat the reply streams into.
  const { isPending } = useActiveStream()
  // Switching or restoring a session: sending is off but the draft is kept.
  const disabled = useBusy()
  const switching = useChatStore((s) => s.switching)
  const field = useRef<HTMLTextAreaElement>(null)
  // Opening, starting or deleting a chat ends with the cursor in the composer,
  // also for "New chat" from a chat that was never sent (its id stays null).
  useEffect(() => {
    if (!switching) field.current?.focus()
  }, [switching])
  // One draft per chat; an unsaved new chat uses "new" until its first send.
  const key = useSession((s) => s.activeId) ?? "new"
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const draft = drafts[key] ?? ""
  const setDraft = (text: string) =>
    setDrafts((prev) => ({ ...prev, [key]: text }))
  function sendMessage() {
    if (isPending || disabled || !draft.trim()) return
    if (send(draft)) setDraft("")
  }

  return (
    <div className="w-full shrink-0 bg-background pb-4">
      <FieldGroup>
        <Field className="flex flex-col gap-1">
          <InputGroup className="bg-composer shadow-[0_1px_3px_rgb(0_0_0/0.04)] has-[[data-slot=input-group-control]:focus-visible]:ring-1 has-[[data-slot=input-group-control]:focus-visible]:ring-ring/30">
            <InputGroupTextarea
              ref={field}
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
              className="flex items-center justify-between gap-2 px-4"
            >
              <Dialog>
                <DialogTrigger asChild>
                  <InputGroupButton
                    variant="ghost"
                    size="sm"
                    className="min-w-0 max-w-[75%] -ml-2"
                    aria-label={`Model: ${selectedModel || "none"}, effort ${selectedEffort}. Change`}
                  >
                    <span className="truncate">
                      {selectedModel || "Select a model"}
                    </span>
                    {providerName && (
                      <span className="hidden shrink-0 font-normal text-muted-foreground sm:inline">
                        · {providerName}
                      </span>
                    )}
                    <Badge variant="secondary" className="shrink-0 capitalize">
                      {selectedEffort}
                    </Badge>
                  </InputGroupButton>
                </DialogTrigger>
                <ModelSetting />
              </Dialog>
              <div className="shrink-0">
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
