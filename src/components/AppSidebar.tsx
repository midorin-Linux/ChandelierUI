import { useState } from "react"
import {
  LoaderCircleIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react"
import { AppMenu } from "@/src/components/AppMenu"
import { SearchChats } from "@/src/components/SearchChats"
import { Dialog } from "@/src/components/ui/dialog"
import { toast } from "sonner"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/src/components/ui/dropdown-menu"
import { Input } from "@/src/components/ui/input"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from "@/src/components/ui/sidebar"
import { groupSessions } from "@/src/lib/sessionGroups"
import { isSubmitEnter } from "@/src/lib/utils"
import {
  deleteSession as onDelete,
  newSession as onNew,
  openSession as onSelect,
  renameSession as onRename,
  useCanSwitch,
  useSession,
  useStreamingSessionId,
} from "@/src/stores/chat"
import type { SessionSummary } from "@/src/types/session"

export function AppSidebar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const sessions = useSession((s) => s.sessions)
  const activeId = useSession((s) => s.activeId)
  const disabled = !useCanSwitch()
  const streamingId = useStreamingSessionId()
  const [renamingId, setRenamingId] = useState<string | null>(null)
  // Deleted but still undoable: hidden now, removed when the toast closes.
  const [hidden, setHidden] = useState<readonly string[]>([])
  const [searching, setSearching] = useState(false)
  const groups = groupSessions(
    sessions.filter((session) => !hidden.includes(session.id)),
    ""
  )

  function remove(session: SessionSummary) {
    if (session.id === activeId) onNew()
    setHidden((ids) => [...ids, session.id])
    let undone = false
    let settled = false
    // Sonner may report one close more than once (action, dismiss, timeout).
    const settle = () => {
      if (settled) return
      settled = true
      if (!undone) onDelete(session.id)
      setHidden((ids) => ids.filter((id) => id !== session.id))
    }
    toast(`Deleted “${session.title || "Untitled"}”`, {
      description: "Its analysis data is deleted too.",
      action: {
        label: "Undo",
        onClick: () => {
          undone = true
          settle()
        },
      },
      onDismiss: settle,
      onAutoClose: settle,
    })
  }

  function finishRename(id: string, title: string) {
    setRenamingId(null)
    const trimmed = title.trim()
    if (trimmed && trimmed !== sessions.find((s) => s.id === id)?.title) {
      onRename(id, trimmed)
    }
  }

  return (
    <>
      <div className="flex w-12 shrink-0 flex-col items-center bg-sidebar py-2 text-sidebar-foreground md:hidden">
        <SidebarTrigger className="size-8" />
      </div>
      <Sidebar collapsible="icon">
        <SidebarHeader
          data-tauri-drag-region
          className="h-10 flex-row items-center p-0 pl-2"
        >
          <SidebarTrigger className="size-8 shrink-0" />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton disabled={disabled} onClick={onNew}>
                  <PlusIcon />
                  <span>New chat</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="Search chats"
                  onClick={() => setSearching(true)}
                >
                  <SearchIcon />
                  <span>Search chats</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
          {groups.map((group) => (
            <SidebarGroup
              key={group.label}
              className="group-data-[collapsible=icon]:hidden"
            >
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarMenu>
                {group.sessions.map((session) => (
                  <SidebarMenuItem key={session.id}>
                    {renamingId === session.id ? (
                      <Input
                        ref={(node) => node?.focus()}
                        aria-label="Chat title"
                        defaultValue={session.title}
                        onBlur={(event) => {
                          // Enter/Escape already finished; unmounting may blur again.
                          if (!event.target.dataset.done) {
                            finishRename(session.id, event.target.value)
                          }
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.currentTarget.dataset.done = "1"
                            setRenamingId(null)
                          } else if (isSubmitEnter(event)) {
                            event.currentTarget.dataset.done = "1"
                            finishRename(session.id, event.currentTarget.value)
                          }
                        }}
                      />
                    ) : (
                      <>
                        <SidebarMenuButton
                          isActive={session.id === activeId}
                          disabled={disabled}
                          onClick={() => onSelect(session.id)}
                          onDoubleClick={() => setRenamingId(session.id)}
                          onKeyDown={(event) => {
                            if (event.key === "F2") {
                              event.preventDefault()
                              setRenamingId(session.id)
                            }
                          }}
                        >
                          {session.id === streamingId && (
                            <LoaderCircleIcon
                              className="animate-spin text-muted-foreground"
                              aria-label="Generating a reply"
                            />
                          )}
                          <span className="truncate">
                            {session.title || "Untitled"}
                          </span>
                        </SidebarMenuButton>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <SidebarMenuAction
                              showOnHover
                              aria-label="Chat actions"
                            >
                              <MoreHorizontalIcon />
                            </SidebarMenuAction>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            <DropdownMenuItem
                              onSelect={() => setRenamingId(session.id)}
                            >
                              <PencilIcon />
                              Rename
                              <DropdownMenuShortcut>F2</DropdownMenuShortcut>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={disabled || session.id === streamingId}
                              onSelect={() => remove(session)}
                            >
                              <Trash2Icon />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </>
                    )}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarFooter className="p-1 border-t">
          <SidebarGroup className="p-0">
            <SidebarMenu>
              <SidebarMenuItem>
                <AppMenu onOpenSettings={onOpenSettings}>
                  <SidebarMenuButton>
                    <span>Chandelier UI</span>
                  </SidebarMenuButton>
                </AppMenu>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        </SidebarFooter>
      </Sidebar>
      <Dialog open={searching} onOpenChange={setSearching}>
        {searching && <SearchChats onDone={() => setSearching(false)} />}
      </Dialog>
    </>
  )
}
