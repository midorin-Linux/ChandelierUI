import { useEffect, useRef, useState, type ReactNode } from "react"
import {
  BrainIcon,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Pencil,
  RefreshCw,
} from "lucide-react"
import { Button } from "@/src/components/ui/button"
import { Textarea } from "@/src/components/ui/textarea"
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
import { children, siblings } from "@/src/lib/sessionTree"
import { isSubmitEnter } from "@/src/lib/utils"
import type { ChatMessage } from "@/src/types/chat"
import type { MessageNode } from "@/src/types/session"

export function ChatUI({
  messages,
  allMessages,
  partialMessage,
  isPending,
  busy,
  error,
  canSend,
  onRetry,
  onRegenerate,
  onEdit,
  onSwitch,
}: {
  messages: readonly MessageNode[]
  /** Every node in the session, to find siblings. */
  allMessages: readonly MessageNode[]
  partialMessage: ChatMessage | null
  isPending: boolean
  /** Sending, switching or restoring: hides the missing-reply notice. */
  busy: boolean
  error: string | null
  canSend: boolean
  onRetry: () => void
  onRegenerate: (message: MessageNode) => void
  onEdit: (message: MessageNode, content: string) => void
  onSwitch: (nodeId: string) => void
}) {
  const messageEnd = useRef<HTMLDivElement>(null)
  useEffect(() => {
    messageEnd.current?.scrollIntoView({ block: "nearest" })
  }, [messages, partialMessage, isPending, error])
  const canRetry = canSend && awaitsReply(messages, busy)
  // A user message that already has replies (e.g. a failed regenerate): let the user go back to them.
  const last = messages[messages.length - 1]
  const replies = last?.role === "user" ? children(allMessages, last.id) : []
  const strandedNav = (
    <SiblingNav
      nodes={replies}
      currentId={null}
      disabled={busy}
      onSelect={onSwitch}
    />
  )
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
          messages.map((message) => {
            const nav = (
              <SiblingNav
                nodes={siblings(allMessages, message)}
                currentId={message.id}
                disabled={busy}
                onSelect={onSwitch}
              />
            )
            return message.role === "assistant" ? (
              <AssistantMessage
                key={message.id}
                message={message}
                actions={
                  <>
                    {nav}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Regenerate response"
                      disabled={busy || !canSend}
                      onClick={() => onRegenerate(message)}
                    >
                      <RefreshCw size={16} />
                    </Button>
                  </>
                }
              />
            ) : (
              <UserMessage
                key={message.id}
                message={message}
                nav={nav}
                disabled={busy}
                canEdit={canSend}
                onEdit={onEdit}
              />
            )
          })
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
            <div className="flex items-center gap-2">
              <Button variant="outline" disabled={!canRetry} onClick={onRetry}>
                Retry
              </Button>
              {strandedNav}
            </div>
          </div>
        )}
        {error === null && awaitsReply(messages, busy) && (
          <div className="space-y-2 rounded-lg border p-3">
            <p role="status" className="text-sm text-muted-foreground">
              No response yet.
              {!canSend && " Open Provider settings and select a model."}
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" disabled={!canRetry} onClick={onRetry}>
                Retry
              </Button>
              {strandedNav}
            </div>
          </div>
        )}
        <div ref={messageEnd} />
      </div>
    </div>
  )
}

/** `◀ n/m ▶` over sibling nodes; renders nothing for fewer than two. A null `currentId` shows `–`. */
function SiblingNav({
  nodes,
  currentId,
  disabled,
  onSelect,
}: {
  nodes: readonly MessageNode[]
  currentId: string | null
  disabled: boolean
  onSelect: (nodeId: string) => void
}) {
  if (nodes.length < 2) return null
  const index = nodes.findIndex((node) => node.id === currentId)
  // With no current node (index -1), previous goes to the last and next to the first.
  const go = (target: number) =>
    onSelect(nodes[(target + nodes.length) % nodes.length].id)
  return (
    <div className="flex items-center text-xs text-muted-foreground">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Previous version"
        disabled={disabled || index === 0}
        onClick={() => go(index - 1)}
      >
        <ChevronLeft size={16} />
      </Button>
      <span>
        {index < 0 ? "–" : index + 1}/{nodes.length}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Next version"
        disabled={disabled || index === nodes.length - 1}
        onClick={() => go(index + 1)}
      >
        <ChevronRight size={16} />
      </Button>
    </div>
  )
}

function UserMessage({
  message,
  nav,
  disabled,
  canEdit,
  onEdit,
}: {
  message: MessageNode
  nav: ReactNode
  disabled: boolean
  canEdit: boolean
  onEdit: (message: MessageNode, content: string) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  const editing = draft !== null
  useEffect(() => {
    if (editing) field.current?.focus()
  }, [editing])
  const submit = () => {
    if (draft === null || !draft.trim()) return
    onEdit(message, draft)
    setDraft(null)
  }
  return (
    <div className="mb-4 flex flex-col gap-2">
      {draft === null ? (
        <article className="ml-auto max-w-[85%] rounded-xl bg-muted p-3">
          <h2 className="mb-1 text-xs font-medium text-muted-foreground">
            You
          </h2>
          <p className="whitespace-pre-wrap wrap-break-word">
            {message.content}
          </p>
        </article>
      ) : (
        <div className="flex flex-col gap-2">
          <Textarea
            ref={field}
            aria-label="Edit message"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setDraft(null)
              else if (isSubmitEnter(event) && !event.shiftKey) {
                event.preventDefault()
                submit()
              }
            }}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button disabled={!draft.trim() || disabled} onClick={submit}>
              Send
            </Button>
          </div>
        </div>
      )}
      <div className="flex items-center justify-end gap-1">
        {nav}
        <CopyButton text={message.content} />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Edit message"
          disabled={disabled || !canEdit || draft !== null}
          onClick={() => setDraft(message.content)}
        >
          <Pencil size={16} />
        </Button>
      </div>
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      return
    }
    setCopied(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), 2000)
  }
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={copied ? "Copied" : "Copy message"}
      onClick={() => void copy()}
    >
      {copied ? <Check size={16} /> : <Copy size={16} />}
    </Button>
  )
}

function AssistantMessage({
  message,
  isPending = false,
  failed = false,
  actions,
}: {
  message: ChatMessage
  isPending?: boolean
  failed?: boolean
  actions?: ReactNode
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
      {message.content && !isPending && (
        <div className="flex items-center gap-1">
          <CopyButton text={message.content} />
          {actions}
        </div>
      )}
      {failed && (
        <p className="text-sm text-muted-foreground">
          Incomplete response. This output is not included when you retry.
        </p>
      )}
    </article>
  )
}
