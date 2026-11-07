import { useEffect, useRef } from "react"
import { Button } from "./ui/button"
import { Textarea } from "./ui/textarea"

export interface ChatInputProps {
  id: string
  label: string
  value: string
  disabled: boolean
  busy?: boolean
  cancelling?: boolean
  submitLabel?: string
  focusOnMount?: boolean
  onChange: (value: string) => void
  onSubmit: () => void
  onStop?: () => void
  onCancel?: () => void
}

export function ChatInput({
  id,
  label,
  value,
  disabled,
  busy = false,
  cancelling = false,
  submitLabel = "送信",
  focusOnMount = false,
  onChange,
  onSubmit,
  onStop,
  onCancel,
}: ChatInputProps) {
  const input = useRef<HTMLTextAreaElement>(null)
  const composing = useRef(false)
  useEffect(() => {
    if (focusOnMount) input.current?.focus()
  }, [focusOnMount])

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (!disabled && !busy && !composing.current && value.trim()) onSubmit()
      }}
    >
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <Textarea
        ref={input}
        className="max-h-48 overflow-y-auto"
        id={id}
        value={value}
        rows={3}
        disabled={disabled || busy}
        aria-describedby={`${id}-help`}
        onChange={(event) => onChange(event.target.value)}
        onCompositionStart={() => {
          composing.current = true
        }}
        onCompositionEnd={() => {
          composing.current = false
        }}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing &&
            event.nativeEvent.keyCode !== 229 &&
            !composing.current
          ) {
            event.preventDefault()
            if (!disabled && !busy && value.trim()) onSubmit()
          }
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p id={`${id}-help`} className="text-xs text-muted-foreground">
          Enterで送信・Shift+Enterで改行。日本語変換中は送信しません。
        </p>
        <div className="flex gap-2">
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onCancel}
            >
              キャンセル
            </Button>
          )}
          {busy && onStop ? (
            <Button
              type="button"
              variant="destructive"
              disabled={cancelling}
              onClick={onStop}
            >
              {cancelling ? "停止中…" : "生成を停止"}
            </Button>
          ) : (
            <Button type="submit" disabled={disabled || busy || !value.trim()}>
              {submitLabel}
            </Button>
          )}
        </div>
      </div>
    </form>
  )
}
