import type { Session } from "../types/domain"
import { SessionList } from "./SessionList"
import { SessionTitleForm } from "./SessionTitleForm"
import { Button } from "./ui/button"

interface SidebarProps {
  sessions: Session[]
  selectedSessionId: string | null
  title: string
  loading: boolean
  disabled: boolean
  settingsOpen: boolean
  onSettingsToggle: () => void
  onTitleChange: (title: string) => void
  onCreate: () => void
  onSelect: (sessionId: string) => void
}

export function Sidebar({
  sessions,
  selectedSessionId,
  title,
  loading,
  disabled,
  settingsOpen,
  onSettingsToggle,
  onTitleChange,
  onCreate,
  onSelect,
}: SidebarProps) {
  return (
    <aside className="workspace-sidebar" aria-label="セッション管理">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Chandelier</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          ローカルに保存される会話
        </p>
      </header>
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        aria-pressed={settingsOpen}
        onClick={onSettingsToggle}
      >
        {settingsOpen ? "会話に戻る" : "設定を開く"}
      </Button>
      <SessionTitleForm
        id="new-session-title"
        label="新しいセッションのタイトル"
        value={title}
        submitLabel="セッションを作成"
        disabled={disabled}
        onChange={onTitleChange}
        onSubmit={onCreate}
      />
      <nav
        className="min-h-0 overflow-y-auto"
        aria-label="セッション一覧"
        aria-busy={loading}
      >
        <h2 className="mb-2 text-xs font-semibold text-muted-foreground">
          セッション
        </h2>
        {loading ? (
          <p role="status" className="text-sm text-muted-foreground">
            セッションを読み込み中…
          </p>
        ) : (
          <SessionList
            sessions={sessions}
            selectedSessionId={selectedSessionId}
            disabled={disabled}
            onSelect={onSelect}
          />
        )}
      </nav>
    </aside>
  )
}
