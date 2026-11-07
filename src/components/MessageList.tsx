import type { Message } from "../types/domain"
import { MessageItem, type MessageItemProps } from "./MessageItem"

export interface MessageListProps extends Omit<
  MessageItemProps,
  "message" | "onRegenerate"
> {
  messages: Message[]
  onRegenerate?: () => void
}

export function MessageList({
  messages,
  onRegenerate,
  ...props
}: MessageListProps) {
  if (messages.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        保存されたメッセージはまだありません。
      </p>
    )
  }
  return (
    <ol className="space-y-6" aria-label="メッセージ">
      {messages.map((message, index) => (
        <MessageItem
          key={message.id}
          message={message}
          {...props}
          onRegenerate={
            index === messages.length - 1 && message.role === "assistant"
              ? onRegenerate
              : undefined
          }
        />
      ))}
    </ol>
  )
}
