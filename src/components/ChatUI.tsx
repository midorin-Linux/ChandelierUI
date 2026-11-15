import { useEffect, useRef } from "react"
import { Button } from "@/src/components/ui/button"
import type { ChatMessage } from "@/src/types/chat"

export function ChatUI({
  messages,
  isPending,
  error,
  canSend,
  onRetry,
}: {
  messages: readonly ChatMessage[]
  isPending: boolean
  error: string | null
  canSend: boolean
  onRetry: () => void
}) {
  const messageEnd = useRef<HTMLDivElement>(null)
  useEffect(() => {
    messageEnd.current?.scrollIntoView({ block: "nearest" })
  }, [messages, isPending, error])
  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto p-4"
      role="log"
      aria-label="Conversation"
      aria-live="polite"
    >
      {messages.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Start a conversation. Messages stay in this window only.
        </p>
      ) : (
        messages.map((message, index) =>
          message.role === "assistant" ? (
            <p key={index} className="mb-4 whitespace-pre-wrap wrap-break-word">
              {message.content}
            </p>
          ) : (
            <article
              key={index}
              className="mb-4 ml-auto max-w-[85%] rounded-xl bg-muted p-3"
            >
              <h2 className="mb-1 text-xs font-medium text-muted-foreground">
                {message.role === "user" ? "You" : message.role}
              </h2>
              <p className="whitespace-pre-wrap wrap-break-words">
                {message.content}
              </p>
            </article>
          )
        )
      )}
      {isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          Waiting for the model…
        </p>
      )}
      {error !== null && (
        <div className="space-y-2 rounded-lg border border-destructive p-3">
          <p
            role="alert"
            className="whitespace-pre-wrap wrap-break-words text-sm"
          >
            {error}
          </p>
          <p className="text-sm text-muted-foreground">
            Your messages are kept. Check the local server, provider URL, model
            ID, and effort support, then retry with the current settings.
          </p>
          <Button
            variant="outline"
            disabled={
              isPending ||
              !canSend ||
              messages[messages.length - 1]?.role !== "user"
            }
            onClick={onRetry}
          >
            Retry
          </Button>
        </div>
      )}
      <div ref={messageEnd} />
    </div>
  )
}
