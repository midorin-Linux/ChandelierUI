import { useState } from "react"
import { AppLayout } from "./components/AppLayout"
import { Sidebar } from "./components/Sidebar"
import type { SessionAction } from "./components/ChatView"
import { ChatWorkspace } from "./components/ChatWorkspace"
import { Button } from "./components/ui/button"
import { useSessions } from "./hooks/useSessions"
import { useChat } from "./hooks/useChat"
import { SettingsView } from "./components/SettingsView"
import { useSettings } from "./hooks/useSettings"
import { usePreferences } from "./hooks/usePreferences"
import "./App.css"
import "./components/workspace.css"
import "./components/settings.css"

function App() {
  const workspace = useSessions()
  const settings = useSettings()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [newTitle, setNewTitle] = useState("")
  const [renameTitle, setRenameTitle] = useState("")
  const [action, setAction] = useState<SessionAction>("none")
  const { bootstrap, detail, isMutating } = workspace
  const sessionDetail = detail.data
  const chat = useChat(
    sessionDetail,
    bootstrap.data?.models ?? [],
    isMutating || settings.pending !== null || action !== "none"
  )
  const editingDisabled =
    isMutating || settings.pending !== null || chat.busy || chat.isModelUpdating
  const chatDisabled = editingDisabled || !chat.hasModel || action !== "none"
  usePreferences(bootstrap.data?.settings)

  function selectSession(sessionId: string) {
    workspace.clearMutationError()
    setAction("none")
    workspace.selectSession(sessionId)
    setSettingsOpen(false)
  }

  function createSession() {
    workspace.clearMutationError()
    workspace.create.mutate(newTitle.trim(), {
      onSuccess: () => {
        setNewTitle("")
        setAction("none")
        setSettingsOpen(false)
      },
    })
  }

  return (
    <>
      <a href="#main-content" className="skip-link">
        会話へ移動
      </a>
      <AppLayout
        sidebar={
          <Sidebar
            sessions={workspace.sessions}
            selectedSessionId={workspace.selectedSessionId}
            title={newTitle}
            loading={bootstrap.isPending}
            disabled={isMutating || !bootstrap.data || bootstrap.isError}
            settingsOpen={settingsOpen}
            onSettingsToggle={() => setSettingsOpen((open) => !open)}
            onTitleChange={setNewTitle}
            onCreate={createSession}
            onSelect={selectSession}
          />
        }
      >
        {workspace.mutationError && (
          <div
            role="alert"
            className="border-b border-destructive/40 p-4 text-sm text-destructive"
          >
            操作に失敗しました：{workspace.mutationError.message}
          </div>
        )}
        {isMutating && (
          <p
            role="status"
            className="border-b px-5 py-2 text-sm text-muted-foreground"
          >
            変更を保存中…
          </p>
        )}
        {settingsOpen && bootstrap.data && (
          <SettingsView
            data={bootstrap.data}
            session={sessionDetail?.session}
            sessionBusy={chat.busy || chat.isModelUpdating || isMutating}
            generationActive={settings.generationActive}
            pending={settings.pending}
            error={settings.error}
            notice={settings.notice}
            onBack={() => setSettingsOpen(false)}
            onSaveProvider={settings.saveProvider}
            onDeleteProvider={settings.deleteProvider}
            onTestProvider={settings.testProvider}
            onRefreshModels={settings.refreshModels}
            onSaveModel={settings.saveModel}
            onDeleteModel={settings.deleteModel}
            onSaveApp={settings.saveApp}
            onSaveSession={settings.saveSession}
          />
        )}
        <div className="chat-panel" hidden={settingsOpen}>
          {bootstrap.isPending ? (
            <p role="status" className="p-6 text-sm text-muted-foreground">
              アプリのデータを読み込み中…
            </p>
          ) : bootstrap.isError ? (
            <section className="space-y-3 p-6" aria-label="読み込みエラー">
              <p role="alert" className="text-sm text-destructive">
                読み込みに失敗しました：{bootstrap.error.message}
              </p>
              <Button
                type="button"
                variant="outline"
                disabled={bootstrap.isFetching}
                onClick={() => {
                  void bootstrap.refetch()
                }}
              >
                再読み込み
              </Button>
            </section>
          ) : workspace.selectedSessionId === null ? (
            <section className="space-y-3 p-6">
              <h2 className="text-lg font-semibold">
                会話を保存する場所をつくりましょう
              </h2>
              <p className="text-sm text-muted-foreground">
                左側のフォームから新しいセッションを作成してください。
              </p>
            </section>
          ) : detail.isPending ? (
            <p role="status" className="p-6 text-sm text-muted-foreground">
              メッセージ履歴を読み込み中…
            </p>
          ) : detail.isError ? (
            <section className="space-y-3 p-6" aria-label="履歴読み込みエラー">
              <p role="alert" className="text-sm text-destructive">
                履歴を読み込めませんでした：{detail.error.message}
              </p>
              <Button
                type="button"
                variant="outline"
                disabled={detail.isFetching}
                onClick={() => {
                  void detail.refetch()
                }}
              >
                再読み込み
              </Button>
            </section>
          ) : sessionDetail ? (
            <ChatWorkspace
              key={sessionDetail.session.id}
              detail={sessionDetail}
              live={chat.generation}
              autoScroll={bootstrap.data?.settings.auto_scroll ?? true}
              visible={!settingsOpen}
              chatView={{
                session: sessionDetail.session,
                messages: chat.messages,
                action,
                title: renameTitle,
                disabled: editingDisabled || chat.editing !== null,
                refreshing: detail.isFetching,
                modelSelector: {
                  models: bootstrap.data?.models ?? [],
                  providers: bootstrap.data?.providers ?? [],
                  value: sessionDetail.session.selected_model_id,
                  disabled:
                    editingDisabled ||
                    action !== "none" ||
                    chat.editing !== null,
                  onChange: chat.selectModel,
                },
                composer: {
                  id: "chat-input",
                  label: "メッセージ",
                  value: chat.draft,
                  disabled: chatDisabled || chat.editing !== null,
                  busy: chat.busy,
                  cancelling: chat.generation?.cancelling,
                  onChange: chat.setDraft,
                  onSubmit: chat.send,
                  onStop: chat.stop,
                },
                messageControls: {
                  disabled: chatDisabled,
                  editing: chat.editing,
                  onCopy: chat.copy,
                  onEdit: chat.startEdit,
                  onEditContentChange: chat.setEditContent,
                  onEditSubmit: chat.submitEdit,
                  onEditCancel: chat.cancelEdit,
                  onRegenerate: chat.canRegenerate
                    ? chat.regenerate
                    : undefined,
                },
                status:
                  chat.generation?.status === "pending"
                    ? "生成を開始しています…"
                    : chat.busy
                      ? "応答を生成中…"
                      : chat.generation?.status === "cancelled"
                        ? "生成を停止しました。受信済みの本文は保存されています。"
                        : chat.isModelUpdating
                          ? "モデルを保存中…"
                          : null,
                error: chat.error,
                notice: chat.notice,
                onTitleChange: setRenameTitle,
                onRenameRequest: () => {
                  workspace.clearMutationError()
                  setRenameTitle(sessionDetail.session.title)
                  setAction("rename")
                },
                onRename: () => {
                  workspace.clearMutationError()
                  workspace.rename.mutate(
                    {
                      session: sessionDetail.session,
                      title: renameTitle.trim(),
                    },
                    {
                      onSuccess: () => setAction("none"),
                    }
                  )
                },
                onDeleteRequest: () => {
                  workspace.clearMutationError()
                  setAction("delete")
                },
                onDelete: () => {
                  workspace.clearMutationError()
                  workspace.remove.mutate(sessionDetail.session.id, {
                    onSuccess: () => setAction("none"),
                  })
                },
                onCancel: () => {
                  workspace.clearMutationError()
                  setAction("none")
                },
              }}
            />
          ) : null}
        </div>
      </AppLayout>
    </>
  )
}

export default App
