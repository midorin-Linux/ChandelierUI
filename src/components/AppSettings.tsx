import { useState } from "react"
import type { AppPreferences } from "../types/domain"
import { Button } from "./ui/button"
import { GenerationSettings } from "./GenerationSettings"

interface AppSettingsProps {
  settings: AppPreferences
  dataDirectory: string
  disabled: boolean
  onSave: (settings: AppPreferences) => Promise<boolean>
}

export function AppSettings({
  settings,
  dataDirectory,
  disabled,
  onSave,
}: AppSettingsProps) {
  const [draft, setDraft] = useState(settings)
  return (
    <section
      className="settings-section"
      aria-labelledby="app-settings-heading"
    >
      <h3 id="app-settings-heading">アプリケーション</h3>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void onSave(draft)
        }}
      >
        <fieldset disabled={disabled} className="settings-fields">
          <legend>表示と既定値</legend>
          <label>
            テーマ
            <select
              className="session-title-input"
              value={draft.theme}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  theme: event.target.value as AppPreferences["theme"],
                })
              }
            >
              <option value="system">System（OSに追従）</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <label>
            チャット表示幅（px）
            <input
              className="session-title-input"
              type="number"
              required
              min={480}
              max={1600}
              step={1}
              value={draft.chat_width}
              onChange={(event) =>
                setDraft({ ...draft, chat_width: event.target.valueAsNumber })
              }
            />
          </label>
          <label>
            チャットのフォントサイズ（px）
            <input
              className="session-title-input"
              type="number"
              required
              min={12}
              max={28}
              step={1}
              value={draft.font_size}
              onChange={(event) =>
                setDraft({ ...draft, font_size: event.target.valueAsNumber })
              }
            />
          </label>
          <label className="settings-checkbox">
            <input
              type="checkbox"
              checked={draft.auto_scroll}
              onChange={(event) =>
                setDraft({ ...draft, auto_scroll: event.target.checked })
              }
            />
            新しいメッセージ・ストリーミングに合わせて自動スクロール
          </label>
          <label>
            ログレベル
            <select
              className="session-title-input"
              value={draft.log_level}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  log_level: event.target.value as AppPreferences["log_level"],
                })
              }
            >
              {["off", "error", "warn", "info", "debug", "trace"].map(
                (level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                )
              )}
            </select>
          </label>
          <label>
            データ保存先（読み取り専用）
            <input
              className="session-title-input"
              readOnly
              value={dataDirectory}
            />
          </label>
          <GenerationSettings
            id="app-generation"
            value={draft.generation}
            disabled={disabled}
            onChange={(generation) => setDraft({ ...draft, generation })}
          />
          <div className="settings-actions">
            <Button type="submit">アプリ設定を保存</Button>
          </div>
        </fieldset>
      </form>
    </section>
  )
}
