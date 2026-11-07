import type { Message } from "../types/domain"
import { Button } from "./ui/button"
import { ChatInput } from "./ChatInput"

export interface MessageItemProps {
  message: Message
  disabled: boolean
  editing: { messageId: string; content: string } | null
  onCopy: (message: Message) => void
  onEdit: (message: Message) => void
  onEditContentChange: (content: string) => void
  onEditSubmit: () => void
  onEditCancel: () => void
  onRegenerate?: () => void
}

const roleLabels: Record<string, string> = {
  user: "あなた",
  assistant: "アシスタント",
  system: "システム",
  tool: "ツール",
}
const statusLabels: Record<string, string> = {
  pending: "待機中",
  streaming: "生成中",
  completed: "完了",
  failed: "失敗",
  cancelled: "キャンセル済み",
}

export function MessageItem({
  message,
  disabled,
  editing,
  onCopy,
  onEdit,
  onEditContentChange,
  onEditSubmit,
  onEditCancel,
  onRegenerate,
}: MessageItemProps) {
  return (
    <li
      className={`message-item ${message.role === "user" ? "message-item-user" : ""}`}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium">
          {Object.prototype.hasOwnProperty.call(roleLabels, message.role)
            ? roleLabels[message.role]
            : message.role}
        </span>
        <span>
          {Object.prototype.hasOwnProperty.call(statusLabels, message.status)
            ? statusLabels[message.status]
            : message.status}
        </span>
        <time dateTime={new Date(message.created_at).toISOString()}>
          {new Date(message.created_at).toLocaleString("ja-JP")}
        </time>
      </div>
      {editing?.messageId === message.id ? (
        <div className="w-full space-y-3 rounded-lg border p-3">
          <p className="text-sm text-muted-foreground">
            このメッセージ以降の表示を編集後の会話に置き換えます。元のメッセージと生成履歴は削除せず保存されます。
          </p>
          <ChatInput
            id={`edit-${message.id}`}
            label="メッセージを編集"
            value={editing.content}
            disabled={disabled}
            submitLabel="編集して再生成"
            focusOnMount
            onChange={onEditContentChange}
            onSubmit={onEditSubmit}
            onCancel={onEditCancel}
          />
        </div>
      ) : (
        <p className="message-content">
          {message.content ||
            (message.status === "streaming" || message.status === "pending"
              ? "応答を待っています…"
              : "（本文なし）")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!message.content}
          aria-label={`${roleLabels[message.role] ?? message.role}のメッセージをコピー`}
          onClick={() => onCopy(message)}
        >
          コピー
        </Button>
        {message.role === "user" && editing?.messageId !== message.id && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => onEdit(message)}
          >
            編集
          </Button>
        )}
        {onRegenerate && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || editing !== null}
            onClick={onRegenerate}
          >
            応答を再生成
          </Button>
        )}
      </div>
    </li>
  )
}
