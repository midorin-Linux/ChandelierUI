import { useEffect, useRef } from "react"
import { BrainIcon } from "lucide-react"
import { Button } from "@/src/components/ui/button"
import { MarkdownRenderer } from "@/src/components/MarkdownRenderer"
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/src/components/ui/trace"
import { awaitsReply } from "@/src/lib/retry"
import type { ChatMessage } from "@/src/types/chat"
import type { MessageNode } from "@/src/types/session"

export function ChatUI({
  messages,
  partialMessage,
  isPending,
  busy,
  error,
  canSend,
  onRetry,
}: {
  messages: readonly MessageNode[]
  partialMessage: ChatMessage | null
  isPending: boolean
  /** Sending, switching or restoring: hides the missing-reply notice. */
  busy: boolean
  error: string | null
  canSend: boolean
  onRetry: () => void
}) {
  const messageEnd = useRef<HTMLDivElement>(null)
  useEffect(() => {
    messageEnd.current?.scrollIntoView({ block: "nearest" })
  }, [messages, partialMessage, isPending, error])
  const canRetry = canSend && awaitsReply(messages, busy)
  return (
    <div
      className="min-h-0 w-full flex-1 overflow-y-auto text-[0.9rem] scroll-pb-[var(--composer-height,0px)]"
      role="log"
      aria-label="Conversation"
      aria-live="polite"
    >
      <div className="mx-auto w-full max-w-3xl border-x border-transparent p-4 pb-[calc(var(--composer-height,0px)+1rem)]">
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Start a conversation. Chats are saved on this device.
          </p>
        ) : (
          messages.map((message) =>
            message.role === "assistant" ? (
              <AssistantMessage key={message.id} message={message} />
            ) : (
              <article
                key={message.id}
                className="mb-4 ml-auto max-w-[85%] rounded-xl bg-muted p-3"
              >
                <h2 className="mb-1 text-xs font-medium text-muted-foreground">
                  {message.role === "user" ? "You" : message.role}
                </h2>
                <p className="whitespace-pre-wrap wrap-break-word">
                  {message.content}
                </p>
              </article>
            )
          )
        )}
        {partialMessage && (
          <AssistantMessage
            message={partialMessage}
            isPending={isPending}
            failed={error !== null}
          />
        )}
        {isPending && (
          <p role="status" className="text-sm text-muted-foreground">
            {partialMessage ? "Receiving response…" : "Waiting for the model…"}
          </p>
        )}
        {error !== null && (
          <div className="space-y-2 rounded-lg border border-destructive p-3">
            <p
              role="alert"
              className="whitespace-pre-wrap wrap-break-word text-sm"
            >
              {error}
            </p>
            <p className="text-sm text-muted-foreground">
              Your messages are kept. Check the local server, provider URL,
              model ID, and effort support, then retry with the current
              settings.
            </p>
            {!canSend && (
              <p role="status" className="text-sm text-muted-foreground">
                Open Provider settings and select a model to enable Retry.
              </p>
            )}
            <Button variant="outline" disabled={!canRetry} onClick={onRetry}>
              Retry
            </Button>
          </div>
        )}
        {error === null && awaitsReply(messages, busy) && (
          <div className="space-y-2 rounded-lg border p-3">
            <p role="status" className="text-sm text-muted-foreground">
              No response yet.
              {!canSend && " Open Provider settings and select a model."}
            </p>
            <Button variant="outline" disabled={!canRetry} onClick={onRetry}>
              Retry
            </Button>
          </div>
        )}
        <div ref={messageEnd} />
      </div>
    </div>
  )
}

function AssistantMessage({
  message,
  isPending = false,
  failed = false,
}: {
  message: ChatMessage
  isPending?: boolean
  failed?: boolean
}) {
  return (
    <article
      aria-label={
        failed ? "Incomplete assistant response" : "Assistant response"
      }
      className="mb-4 flex flex-col gap-3"
    >
      {message.reasoning && (
        <Trace>
          <TraceCollapsible defaultOpen>
            <TraceCollapsibleTrigger>
              <TraceLine
                status={failed ? "error" : isPending ? "running" : undefined}
              >
                <TraceIcon>
                  <BrainIcon />
                </TraceIcon>
                <TraceTitle>
                  {failed
                    ? "Thinking interrupted"
                    : isPending
                      ? "Thinking…"
                      : "Thinking"}
                </TraceTitle>
              </TraceLine>
            </TraceCollapsibleTrigger>
            <TraceCollapsibleContent>
              <p className="whitespace-pre-wrap wrap-break-word">
                {message.reasoning}
              </p>
            </TraceCollapsibleContent>
          </TraceCollapsible>
        </Trace>
      )}
      {message.content && <MarkdownRenderer content={message.content} />}
      {failed && (
        <p className="text-sm text-muted-foreground">
          Incomplete response. This output is not included when you retry.
        </p>
      )}
    </article>
  )
}
