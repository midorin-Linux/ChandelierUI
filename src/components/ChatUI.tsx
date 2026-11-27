import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { Virtuoso, type Components, type VirtuosoHandle } from "react-virtuoso"
import {
  ArrowDownIcon,
  BoxIcon,
  BrainIcon,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  MessageSquareIcon,
  Pencil,
  PlusIcon,
  RefreshCw,
  ServerIcon,
  SettingsIcon,
} from "lucide-react"
import { Button } from "@/src/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/src/components/ui/empty"
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
import { errorHint } from "@/src/lib/errorHint"
import { awaitsReply } from "@/src/lib/retry"
import { children, siblings } from "@/src/lib/sessionTree"
import { isSubmitEnter } from "@/src/lib/utils"
import {
  editMessage as onEdit,
  regenerate as onRegenerate,
  retry as onRetry,
  switchBranch as onSwitch,
  useActiveStream,
  useBusy,
  useChatContext,
  useError,
  useErrorCause,
  useMessages,
  useSession,
} from "@/src/stores/chat"
import { useSettingsStore } from "@/src/stores/settings"
import { openSettings } from "@/src/stores/settingsDialog"
import type { ChatMessage } from "@/src/types/chat"
import type { MessageNode } from "@/src/types/session"

/** A stored message, or the reply still streaming in (it has no id yet). */
type Row = MessageNode | ChatMessage

interface ListContext {
  select: (nodeId: string) => void
}

// Rows are padded, not margined: Virtuoso measures each row's own box.
const column = "mx-auto w-full max-w-3xl border-x border-transparent px-4"
// Copy, edit and regenerate appear on hover or keyboard focus; version arrows stay.
const reveal =
  "opacity-0 transition-opacity group-hover/message:opacity-100 focus-visible:opacity-100"

export function ChatUI() {
  // One list per session: it opens at the bottom and keeps no scroll state from another chat.
  const activeId = useSession((s) => s.activeId)
  return <Conversation key={activeId ?? "new"} />
}

function Conversation() {
  const messages = useMessages()
  // Every node in the session, to find siblings.
  const allMessages = useSession((s) => s.data.messages)
  // Sending, switching or restoring: disables edits and branch switches.
  const busy = useBusy()
  const error = useError()
  const { canSend } = useChatContext()
  // Subscribed here, not in the parent, so only the conversation re-renders per delta.
  const { message: partialMessage, isPending } = useActiveStream()
  const list = useRef<VirtuosoHandle>(null)
  const scroller = useRef<HTMLElement | null>(null)
  // Cleared only by scrolling up, so content growing below the view keeps it set.
  const stuck = useRef(true)
  const lastTop = useRef(0)
  const scrollTarget = useRef<string | null>(null)
  const [atBottom, setAtBottom] = useState(true)
  const context = useMemo<ListContext>(
    () => ({
      select: (id) => {
        scrollTarget.current = id
        // The target is scrolled to below; don't let sticking pull it to the bottom.
        stuck.current = false
        onSwitch(id)
      },
    }),
    []
  )
  useEffect(() => {
    const id = scrollTarget.current
    scrollTarget.current = null
    const index = id ? messages.findIndex((message) => message.id === id) : -1
    if (index >= 0)
      list.current?.scrollToIndex({ index, align: "start", offset: -16 })
  }, [messages])
  // Keeps the bottom in view as the reply grows, unless the user scrolled up.
  const stick = useCallback(() => {
    const element = scroller.current
    if (element && stuck.current) element.scrollTop = element.scrollHeight
  }, [])
  // Before paint, for the DOM React just wrote; rows Virtuoso sizes afterwards are
  // caught by `totalListHeightChanged`.
  useLayoutEffect(stick, [stick, partialMessage, isPending, error])
  const rows = useMemo<Row[]>(
    () => (partialMessage ? [...messages, partialMessage] : messages),
    [messages, partialMessage]
  )
  return (
    <>
      <Virtuoso
        ref={list}
        className="min-h-0 w-full flex-1 text-[0.9rem]"
        // No live region: rows remount while scrolling and would be re-announced.
        // The footer's status line announces progress.
        role="region"
        aria-label="Conversation"
        data={rows}
        context={context}
        components={components}
        computeItemKey={(_, row) => ("id" in row ? row.id : "stream")}
        initialTopMostItemIndex={{ index: "LAST", align: "end" }}
        scrollerRef={(element) => {
          scroller.current = element instanceof HTMLElement ? element : null
        }}
        onScroll={(event) => {
          const { scrollTop, scrollHeight, clientHeight } = event.currentTarget
          if (scrollHeight - scrollTop - clientHeight < 32) stuck.current = true
          else if (scrollTop < lastTop.current) stuck.current = false
          lastTop.current = scrollTop
        }}
        // Growth outside a delta: late highlighting, the finished reply's buttons.
        totalListHeightChanged={stick}
        atBottomStateChange={setAtBottom}
        atBottomThreshold={32}
        // Rows render before they scroll in, so tall replies don't pop in.
        increaseViewportBy={{ top: 800, bottom: 400 }}
        // Jump to the user's own new message, even from above. Off otherwise: while
        // on, Virtuoso also chases a growing last row and pulls back a user who scrolled up.
        followOutput={
          rows[rows.length - 1]?.role === "user" ? () => "auto" : false
        }
        itemContent={(_, row) =>
          "id" in row ? (
            <MessageRow
              message={row}
              allMessages={allMessages}
              busy={busy}
              canSend={canSend}
              onSelect={context.select}
            />
          ) : (
            <div className={`${column} pb-4`}>
              <AssistantMessage
                message={row}
                isPending={isPending}
                failed={error !== null}
              />
            </div>
          )
        }
      />
      {!atBottom && (
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Scroll to latest"
          className="absolute bottom-[calc(var(--composer-height,0px)+0.5rem)] left-1/2 z-10 -translate-x-1/2 rounded-full shadow-md"
          onClick={() => {
            stuck.current = true
            // The scroller, not the last row: the footer below it holds status and errors.
            const element = scroller.current
            element?.scrollTo({ top: element.scrollHeight, behavior: "smooth" })
          }}
        >
          <ArrowDownIcon />
        </Button>
      )}
    </>
  )
}

const components: Components<Row, ListContext> = {
  Header: () => <div className="h-4" />,
  Footer: ListFooter,
}

/** What a chat with no messages shows above the centered composer: the next step towards a first message. */
export function EmptyConversation() {
  const hasProvider = useSettingsStore((s) => s.presets.length > 0)
  const { selectedModel, modelsLoading } = useChatContext()
  const [Icon, title, description] = !hasProvider
    ? [
        ServerIcon,
        "Add a provider to start",
        "Connect any OpenAI-compatible endpoint, local or cloud.",
      ]
    : !selectedModel && !modelsLoading
      ? [
          BoxIcon,
          "Choose a model",
          "Pick one with the model button in the message box below.",
        ]
      : [
          MessageSquareIcon,
          "Start a conversation",
          "Chats are saved on this device. Enter sends, Shift+Enter adds a line.",
        ]
  return (
    <Empty className="p-0 pb-8">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {!hasProvider && (
        <EmptyContent>
          <Button onClick={() => openSettings("provider")}>
            <PlusIcon />
            Add provider
          </Button>
        </EmptyContent>
      )}
    </Empty>
  )
}

/** Status, error and retry below the messages, then room for the composer that overlays the list. */
function ListFooter({ context }: { context?: ListContext }) {
  const messages = useMessages()
  const allMessages = useSession((s) => s.data.messages)
  // Sending, switching or restoring: hides the missing-reply notice.
  const busy = useBusy()
  const error = useError()
  const { canSend } = useChatContext()
  const { message: partialMessage, isPending } = useActiveStream()
  const canRetry = canSend && awaitsReply(messages, busy)
  const cause = useErrorCause()
  const hint = errorHint(cause?.kind ?? null, cause?.status ?? null)
  const settingsTab = hint.settings ?? (canSend ? null : "provider")
  // A user message that already has replies (e.g. a failed regenerate): let the user go back to them.
  const last = messages[messages.length - 1]
  const replies = last?.role === "user" ? children(allMessages, last.id) : []
  const strandedNav = context && (
    <SiblingNav
      nodes={replies}
      currentId={null}
      disabled={busy}
      onSelect={context.select}
    />
  )
  return (
    <div className={`${column} pb-[calc(var(--composer-height,0px)+1rem)]`}>
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
            Your messages are kept. {hint.hint}
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
            {settingsTab && (
              <Button variant="ghost" onClick={() => openSettings(settingsTab)}>
                <SettingsIcon />
                {settingsTab === "general" ? "General" : "Provider"} settings
              </Button>
            )}
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
    </div>
  )
}

/** Memoized: during a stream none of its props change, so finished messages skip rendering. */
const MessageRow = memo(function MessageRow({
  message,
  allMessages,
  busy,
  canSend,
  onSelect,
}: {
  message: MessageNode
  allMessages: readonly MessageNode[]
  busy: boolean
  canSend: boolean
  onSelect: (nodeId: string) => void
}) {
  const nav = (
    <SiblingNav
      nodes={siblings(allMessages, message)}
      currentId={message.id}
      disabled={busy}
      onSelect={onSelect}
    />
  )
  return (
    <div className={`${column} group/message pb-4`}>
      {message.role === "assistant" ? (
        <AssistantMessage
          message={message}
          actions={
            <>
              {nav}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Regenerate response"
                className={reveal}
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
          message={message}
          nav={nav}
          disabled={busy}
          canEdit={canSend}
          onEdit={onEdit}
        />
      )}
    </div>
  )
})

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
    <div className="flex flex-col gap-2">
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
          <div className="flex items-center justify-end gap-2">
            <p className="mr-auto text-xs text-muted-foreground">
              Saved as a new version; the original stays available.
            </p>
            <Button variant="outline" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button disabled={!draft.trim() || disabled} onClick={submit}>
              Save &amp; submit
            </Button>
          </div>
        </div>
      )}
      <div className="flex items-center justify-end gap-1">
        {nav}
        <CopyButton text={message.content} className={reveal} />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Edit message"
          className={reveal}
          disabled={disabled || !canEdit || draft !== null}
          onClick={() => setDraft(message.content)}
        >
          <Pencil size={16} />
        </Button>
      </div>
    </div>
  )
}

function CopyButton({ text, className }: { text: string; className?: string }) {
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
      className={copied ? undefined : className}
      onClick={() => void copy()}
    >
      {copied ? <Check size={16} /> : <Copy size={16} />}
    </Button>
  )
}

/** "Thought for 12s" when the reply recorded its thinking time. */
function thoughtFor(message: Row) {
  const ms = "reasoning_ms" in message ? message.reasoning_ms : undefined
  if (ms == null) return "Thinking"
  const secs = Math.max(1, Math.round(ms / 1000))
  return secs < 60
    ? `Thought for ${secs}s`
    : `Thought for ${Math.floor(secs / 60)}m ${secs % 60}s`
}

function AssistantMessage({
  message,
  isPending = false,
  failed = false,
  actions,
}: {
  message: Row
  isPending?: boolean
  failed?: boolean
  actions?: ReactNode
}) {
  // Open while the model is thinking; collapse once the answer starts or the stream ends.
  const thinking = isPending && !message.content.trim()
  const [open, setOpen] = useState(thinking)
  const [wasThinking, setWasThinking] = useState(thinking)
  if (thinking !== wasThinking) {
    setWasThinking(thinking)
    if (!thinking) setOpen(false)
  }
  return (
    <article
      aria-label={
        failed ? "Incomplete assistant response" : "Assistant response"
      }
      className="flex flex-col gap-3"
    >
      {message.reasoning && (
        <Trace>
          <TraceCollapsible open={open} onOpenChange={setOpen}>
            <TraceCollapsibleTrigger>
              <TraceLine
                status={failed ? "error" : thinking ? "running" : undefined}
              >
                <TraceIcon>
                  <BrainIcon />
                </TraceIcon>
                <TraceTitle>
                  {failed
                    ? "Thinking interrupted"
                    : thinking
                      ? "Thinking…"
                      : thoughtFor(message)}
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
      {message.content && (
        <MarkdownRenderer content={message.content} streaming={isPending} />
      )}
      {message.content && !isPending && (
        <div className="flex items-center gap-1">
          <CopyButton text={message.content} className={reveal} />
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
