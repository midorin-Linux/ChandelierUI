import { useState } from "react"
import type { GenerationParameters, Session } from "../types/domain"
import { Button } from "./ui/button"
import { GenerationSettings } from "./GenerationSettings"

interface SessionSettingsProps {
  session: Session
  disabled: boolean
  onSave: (session: Session, settings: GenerationParameters) => Promise<boolean>
}

export function SessionSettings({
  session,
  disabled,
  onSave,
}: SessionSettingsProps) {
  const [draft, setDraft] = useState(session.session_settings)
  return (
    <section
      className="settings-section"
      aria-labelledby="session-settings-heading"
    >
      <h3 id="session-settings-heading">選択中のセッション：{session.title}</h3>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void onSave(session, draft)
        }}
      >
        <GenerationSettings
          id="session-generation"
          value={draft}
          disabled={disabled}
          onChange={setDraft}
        />
        <div className="settings-actions">
          <Button type="submit" disabled={disabled}>
            セッションの生成設定を保存
          </Button>
        </div>
      </form>
    </section>
  )
}
