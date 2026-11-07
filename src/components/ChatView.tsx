import { useEffect, useRef, type RefObject } from "react"
import type { AppError, Message, Session } from "../types/domain"
import { Button } from "./ui/button"
import { MessageList, type MessageListProps } from "./MessageList"
import { ChatInput, type ChatInputProps } from "./ChatInput"
import { ModelSelector, type ModelSelectorProps } from "./ModelSelector"
import { SessionTitleForm } from "./SessionTitleForm"

export type SessionAction = "none" | "rename" | "delete"

export interface ChatViewProps {
  session: Session
  messages: Message[]
  action: SessionAction
  title: string
  disabled: boolean
  refreshing: boolean
  messagesRef: RefObject<HTMLDivElement | null>
  modelSelector: ModelSelectorProps
  composer: ChatInputProps
  messageControls: Omit<MessageListProps, "messages">
  status: string | null
  error: AppError | null
  notice: string | null
  onTitleChange: (title: string) => void
  onRenameRequest: () => void
  onRename: () => void
  onDeleteRequest: () => void
  onDelete: () => void
  onCancel: () => void
}

export function ChatView({
  session,
  messages,
  action,
  title,
  disabled,
  refreshing,
  messagesRef,
  modelSelector,
  composer,
  messageControls,
  status,
  error,
  notice,
  onTitleChange,
  onRenameRequest,
  onRename,
  onDeleteRequest,
  onDelete,
  onCancel,
}: ChatViewProps) {
  const renameButton = useRef<HTMLButtonElement>(null)
  const deleteButton = useRef<HTMLButtonElement>(null)
  const cancelDeleteButton = useRef<HTMLButtonElement>(null)
  const previousAction = useRef(action)
  useEffect(() => {
    if (action === "delete") cancelDeleteButton.current?.focus()
    if (action === "none" && previousAction.current !== "none") {
      const trigger =
        previousAction.current === "rename" ? renameButton : deleteButton
      trigger.current?.focus()
    }
    previousAction.current = action
  }, [action])

  return (
    <section className="chat-view" aria-label="会話" aria-busy={refreshing}>
      <header className="space-y-4 border-b p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="min-w-0 flex-1 text-lg font-semibold [overflow-wrap:anywhere]">
            {session.title}
          </h2>
          {action === "none" && (
            <div className="flex gap-2">
              <Button
                ref={renameButton}
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={onRenameRequest}
              >
                名前を変更
              </Button>
              <Button
                ref={deleteButton}
                type="button"
                variant="destructive"
                size="sm"
                disabled={disabled}
                onClick={onDeleteRequest}
              >
                削除
              </Button>
            </div>
          )}
        </div>
        {action === "rename" && (
          <SessionTitleForm
            id="rename-session-title"
            label="セッションの新しいタイトル"
            value={title}
            submitLabel="変更を保存"
            disabled={disabled}
            focusOnMount
            onChange={onTitleChange}
            onSubmit={onRename}
            onCancel={onCancel}
          />
        )}
        {action === "delete" && (
          <section
            aria-label="セッション削除の確認"
            className="space-y-3 rounded-lg border border-destructive/40 p-3"
          >
            <p className="text-sm">
              このセッションと保存されたメッセージ・生成履歴を削除します。この操作は取り消せません。
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={disabled}
                onClick={onDelete}
              >
                削除する
              </Button>
              <Button
                ref={cancelDeleteButton}
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={onCancel}
              >
                キャンセル
              </Button>
            </div>
          </section>
        )}
        <ModelSelector {...modelSelector} />
      </header>
      <a href="#message-history" className="skip-link">
        メッセージ履歴へ移動
      </a>
      <div
        id="message-history"
        ref={messagesRef}
        className="chat-messages"
        role="region"
        aria-label="メッセージ履歴"
        tabIndex={-1}
      >
        <MessageList messages={messages} {...messageControls} />
      </div>
      <footer className="space-y-3 border-t px-5 py-3">
        {status && (
          <p role="status" className="text-sm text-muted-foreground">
            {status}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error.message} <span className="text-xs">({error.code})</span>
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm text-muted-foreground">
            {notice}
          </p>
        )}
        <ChatInput {...composer} />
      </footer>
    </section>
  )
}
