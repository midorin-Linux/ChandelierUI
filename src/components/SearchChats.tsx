import { useState } from "react"
import { LoaderCircleIcon, MessageSquareIcon } from "lucide-react"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/src/components/ui/command"
import {
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/src/components/ui/dialog"
import { groupSessions } from "@/src/lib/sessionGroups"
import {
  openSession,
  useSession,
  useStreamingSessionId,
} from "@/src/stores/chat"

/** A dialog to find a chat by title; picking one opens it and closes the dialog. */
export function SearchChats({ onDone }: { onDone: () => void }) {
  const sessions = useSession((s) => s.sessions)
  const activeId = useSession((s) => s.activeId)
  const streamingId = useStreamingSessionId()
  const [query, setQuery] = useState("")
  const groups = groupSessions(sessions, query)

  return (
    <DialogContent className="flex h-[min(36rem,calc(100dvh-2rem))] w-[min(42rem,calc(100%-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
      <header className="border-b px-4 py-4 pr-14">
        <DialogTitle className="text-lg font-semibold">
          Search chats
        </DialogTitle>
        <DialogDescription className="sr-only">
          Type to filter chats by title, then pick one to open it.
        </DialogDescription>
      </header>
      {/* Filtering is ours (titles, grouped by date), not cmdk's fuzzy match. */}
      <Command
        shouldFilter={false}
        className="min-h-0 flex-1 gap-2 rounded-none! p-3"
      >
        <CommandInput
          placeholder="Search by title"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList className="max-h-none flex-1 scroll-pt-2 pt-1">
          <CommandEmpty>
            {sessions.length === 0 ? "No chats yet." : "No chats match."}
          </CommandEmpty>
          {groups.map((group) => (
            <CommandGroup
              key={group.label}
              heading={group.label}
              className="pb-3"
            >
              {group.sessions.map((session) => (
                <CommandItem
                  key={session.id}
                  className="gap-3 px-3 py-2.5"
                  value={session.id}
                  onSelect={() => {
                    if (session.id !== activeId) openSession(session.id)
                    onDone()
                  }}
                >
                  {session.id === streamingId ? (
                    <LoaderCircleIcon
                      className="animate-spin"
                      aria-label="Generating a reply"
                    />
                  ) : (
                    <MessageSquareIcon />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    {session.title || "Untitled"}
                  </span>
                  {/* A shortcut slot: right-aligned, and it hides cmdk's check icon. */}
                  <CommandShortcut className="shrink-0 tracking-normal tabular-nums">
                    {new Date(session.updated_at).toLocaleDateString()}
                  </CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </DialogContent>
  )
}
