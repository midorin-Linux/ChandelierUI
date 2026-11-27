import "./App.css"
import { useEffect } from "react"
import { Analysis } from "@/src/components/Analysis"
import { TitleBar } from "@/src/components/TitleBar"
import { ChatUI, EmptyConversation } from "@/src/components/ChatUI"
import { MessageBox } from "@/src/components/MessageBox"
import { AppSetting } from "@/src/components/AppSetting"
import { Dialog } from "@/src/components/ui/dialog"
import { ThemeProvider } from "@/src/components/ThemeProvider.tsx"
import { SidebarProvider } from "@/src/components/ui/sidebar"
import { Toaster } from "@/src/components/ui/sonner"
import { TooltipProvider } from "@/src/components/ui/tooltip"
import { AppSidebar } from "@/src/components/AppSidebar"
import { settingsWriter } from "@/src/lib/api"
import {
  init,
  useChatContext,
  useMessages,
  useSession,
} from "@/src/stores/chat"
import { cn } from "@/src/lib/utils"
import { loadMissingModels } from "@/src/stores/models"
import { useSettingsStore } from "@/src/stores/settings"
import { openSettings, useSettingsDialog } from "@/src/stores/settingsDialog"

function App() {
  const loaded = useSettingsStore((s) => s.loaded)
  useEffect(() => void init(), [])
  // The theme stays outside the settings gate so it applies without waiting for IPC.
  return (
    <ThemeProvider defaultTheme="system">
      <TooltipProvider>
        {loaded && <Chat />}
        <Toaster />
      </TooltipProvider>
    </ThemeProvider>
  )
}

function Chat() {
  const { open: appSettingsOpen, tab: settingsTab } = useSettingsDialog()
  const { providerMissing } = useChatContext()
  // A chat with no messages yet centers the composer; the first send moves it down.
  const restoring = useSession((s) => s.restoring)
  const messageCount = useMessages().length
  const empty = !restoring && messageCount === 0
  const presets = useSettingsStore((s) => s.presets)
  // Every provider's models are listed, so each is fetched once its URL is set or changed.
  useEffect(() => loadMissingModels(presets), [presets])

  return (
    <>
      <SidebarProvider>
        {/* The menu opens settings at the start; shortcuts like the model
            dialog's "Manage providers" open a specific tab instead. */}
        <AppSidebar onOpenSettings={() => openSettings()} />
        <Dialog
          open={appSettingsOpen}
          onOpenChange={(open) => {
            useSettingsDialog.setState({ open })
            if (!open) void settingsWriter.flush()
          }}
        >
          <AppSetting
            tab={settingsTab}
            onTabChange={(tab) => useSettingsDialog.setState({ tab })}
          />
        </Dialog>
        <div className="flex h-screen min-w-0 flex-1 justify-center">
          <div className="flex min-h-0 w-full flex-col">
            <TitleBar>
              <Analysis />
            </TitleBar>
            <div className="relative flex min-h-0 w-full flex-1 flex-col">
              <ChatUI />
              <div
                className={cn(
                  "absolute left-1/2 w-full max-w-3xl -translate-x-1/2 border-x border-transparent",
                  empty ? "top-1/2 -translate-y-1/2" : "bottom-0"
                )}
                ref={(node) => {
                  if (!node) return
                  const observer = new ResizeObserver(() => {
                    node.parentElement?.style.setProperty(
                      "--composer-height",
                      `${node.offsetHeight}px`
                    )
                  })
                  observer.observe(node)
                  return () => observer.disconnect()
                }}
              >
                {empty && <EmptyConversation />}
                {providerMissing && (
                  <p
                    role="status"
                    className="px-3 pb-1 text-xs text-muted-foreground"
                  >
                    This session&apos;s provider has been deleted. Using the
                    default provider instead.
                  </p>
                )}
                <MessageBox />
              </div>
            </div>
          </div>
        </div>
      </SidebarProvider>
    </>
  )
}

export default App
