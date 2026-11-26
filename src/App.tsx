import "./App.css"
import { useEffect, useState } from "react"
import { Analysis } from "@/src/components/Analysis"
import { TitleBar } from "@/src/components/TitleBar"
import { ChatUI } from "@/src/components/ChatUI"
import { MessageBox } from "@/src/components/MessageBox"
import { AppSetting, type SettingsTab } from "@/src/components/AppSetting"
import { Dialog } from "@/src/components/ui/dialog"
import { ThemeProvider } from "@/src/components/ThemeProvider.tsx"
import { SidebarProvider } from "@/src/components/ui/sidebar"
import { AppSidebar } from "@/src/components/AppSidebar"
import { settingsWriter } from "@/src/lib/api"
import {
  addPreset,
  buildPayload,
  cancelCompletion,
  deleteSession,
  editMessage,
  init,
  newSession,
  openSession,
  refreshModels,
  regenerate,
  removePreset,
  renamePreset,
  renameSession,
  retry,
  selectModel,
  selectProvider,
  sendMessage,
  setEffort,
  setProviderUrl,
  setSystemPrompt,
  switchBranch,
  useBusy,
  useChatContext,
  useChatStore,
  useMessages,
  useSession,
} from "@/src/stores/chat"
import { loadModels } from "@/src/stores/models"
import { useSettingsStore } from "@/src/stores/settings"

function App() {
  const loaded = useSettingsStore((s) => s.loaded)
  useEffect(() => void init(), [])
  // The theme stays outside the settings gate so it applies without waiting for IPC.
  return (
    <ThemeProvider defaultTheme="system">{loaded && <Chat />}</ThemeProvider>
  )
}

function Chat() {
  const presets = useSettingsStore((s) => s.presets)
  const [appSettingsOpen, setAppSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general")
  const context = useChatContext()
  const {
    providerId: activeId,
    providerMissing,
    providerUrl,
    models,
    modelsLoading,
    selectedModel,
    modelsStatus,
    canSend,
  } = context
  useEffect(
    () => void loadModels(providerUrl, activeId),
    [providerUrl, activeId]
  )
  const sessions = useSession((s) => s.sessions)
  const activeSessionId = useSession((s) => s.activeId)
  const data = useSession((s) => s.data)
  const attempts = useSession((s) => s.attempts)
  const messages = useMessages()
  const isPending = useChatStore((s) => s.stream.isPending)
  const error = useChatStore((s) => s.error)
  const busy = useBusy()
  // The URL being typed belongs to one preset, so switching presets drops it.
  const [urlDraft, setUrlDraft] = useState({ id: activeId, value: providerUrl })
  const providerUrlInput =
    urlDraft.id === activeId ? urlDraft.value : providerUrl
  const setProviderUrlInput = (value: string) =>
    setUrlDraft({ id: activeId, value })

  function openProviderSettings() {
    setSettingsTab("provider")
    setAppSettingsOpen(true)
  }

  return (
    <>
      <SidebarProvider>
        <AppSidebar
          sessions={sessions}
          activeId={activeSessionId}
          disabled={busy}
          onNew={newSession}
          onSelect={openSession}
          onRename={renameSession}
          onDelete={deleteSession}
          onOpenSettings={() => setAppSettingsOpen(true)}
        />
        <Dialog
          open={appSettingsOpen}
          onOpenChange={(open) => {
            setAppSettingsOpen(open)
            if (open) return
            // Escape/close unmounts the URL field without a blur.
            const url = providerUrlInput.trim()
            if (url !== providerUrl) setProviderUrl(url)
            void settingsWriter.flush()
          }}
        >
          <AppSetting
            tab={settingsTab}
            onTabChange={setSettingsTab}
            models={models}
            provider={{
              presets,
              activeId,
              onSelectPreset: selectProvider,
              onAddPreset: addPreset,
              onRemovePreset: removePreset,
              onRenamePreset: renamePreset,
              providerUrl,
              setProviderUrl,
              providerUrlInput,
              setProviderUrlInput,
              models,
              modelsLoading,
              modelsStatus,
              onRefreshModels: refreshModels,
            }}
          />
        </Dialog>
        <div className="flex h-screen min-w-0 flex-1 justify-center">
          <div className="flex min-h-0 w-full flex-col">
            <TitleBar>
              <Analysis
                payload={buildPayload(messages, context, data)}
                attempts={attempts}
                isPending={isPending}
              />
            </TitleBar>
            <div className="relative flex min-h-0 w-full flex-1 flex-col">
              <ChatUI
                messages={messages}
                allMessages={data.messages}
                busy={busy}
                error={error}
                canSend={canSend}
                onRetry={retry}
                onRegenerate={regenerate}
                onEdit={editMessage}
                onSwitch={switchBranch}
              />
              <div
                className="absolute bottom-0 left-1/2 w-full max-w-3xl -translate-x-1/2 border-x border-transparent"
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
                {providerMissing && (
                  <p
                    role="status"
                    className="px-3 pb-1 text-xs text-muted-foreground"
                  >
                    This session&apos;s provider has been deleted. Using the
                    current provider instead.
                  </p>
                )}
                <MessageBox
                  models={models}
                  modelsLoading={modelsLoading}
                  modelsStatus={modelsStatus}
                  onRefreshModels={refreshModels}
                  onOpenProviderSettings={openProviderSettings}
                  selectedModel={selectedModel}
                  onModelChange={selectModel}
                  selectedEffort={data.reasoning_effort}
                  onEffortChange={setEffort}
                  systemPrompt={data.system_prompt}
                  onSystemPromptChange={setSystemPrompt}
                  onSend={sendMessage}
                  onCancel={() => void cancelCompletion()}
                  isPending={isPending}
                  disabled={busy}
                />
              </div>
            </div>
          </div>
        </div>
      </SidebarProvider>
    </>
  )
}

export default App
