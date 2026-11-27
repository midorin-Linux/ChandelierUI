import { useState } from "react"
import {
  LoaderCircleIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"
import { AppMenu } from "@/src/components/AppMenu"
import { Button } from "@/src/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/src/components/ui/dropdown-menu"
import { Input } from "@/src/components/ui/input"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from "@/src/components/ui/sidebar"
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
  const [deleting, setDeleting] = useState<SessionSummary | null>(null)

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
            </SidebarMenu>
          </SidebarGroup>
          <SidebarGroup className="group-data-[collapsible=icon]:hidden">
            <SidebarMenu>
              {sessions.map((session) => (
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
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={disabled || session.id === streamingId}
                            onSelect={() => setDeleting(session)}
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
      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this chat?</DialogTitle>
            <DialogDescription>
              “{deleting?.title || "Untitled"}” and its analysis data will be
              permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleting) onDelete(deleting.id)
                setDeleting(null)
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
