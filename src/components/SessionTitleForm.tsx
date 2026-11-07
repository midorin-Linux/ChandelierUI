import { useEffect, useRef } from "react"
import { Button } from "./ui/button"

interface SessionTitleFormProps {
  id: string
  label: string
  value: string
  submitLabel: string
  disabled: boolean
  focusOnMount?: boolean
  onChange: (value: string) => void
  onSubmit: () => void
  onCancel?: () => void
}

export function SessionTitleForm({
  id,
  label,
  value,
  submitLabel,
  disabled,
  focusOnMount,
  onChange,
  onSubmit,
  onCancel,
}: SessionTitleFormProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (focusOnMount) inputRef.current?.focus()
  }, [focusOnMount])

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (!disabled && value.trim()) onSubmit()
      }}
    >
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        ref={inputRef}
        type="text"
        className="session-title-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        required
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={disabled || !value.trim()}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={onCancel}
          >
            キャンセル
          </Button>
        )}
      </div>
    </form>
  )
}
