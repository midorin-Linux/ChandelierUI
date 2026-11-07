import type { Session } from "../types/domain"
import { Button } from "./ui/button"

interface SessionListProps {
  sessions: Session[]
  selectedSessionId: string | null
  disabled: boolean
  onSelect: (sessionId: string) => void
}

export function SessionList({
  sessions,
  selectedSessionId,
  disabled,
  onSelect,
}: SessionListProps) {
  if (sessions.length === 0) {
    return (
      <p className="py-4 text-sm text-muted-foreground">
        セッションはまだありません。
      </p>
    )
  }
  return (
    <ul className="space-y-1">
      {sessions.map((session) => (
        <li key={session.id}>
          <Button
            type="button"
            variant={session.id === selectedSessionId ? "secondary" : "ghost"}
            className="h-auto min-h-10 w-full justify-start py-2 text-left whitespace-normal"
            aria-current={session.id === selectedSessionId ? "page" : undefined}
            disabled={disabled}
            onClick={() => onSelect(session.id)}
          >
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {session.title}
            </span>
          </Button>
        </li>
      ))}
    </ul>
  )
}
