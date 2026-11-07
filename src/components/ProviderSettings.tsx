import { useEffect, useRef, useState } from "react"
import type { Provider } from "../types/domain"
import { Button } from "./ui/button"
import { GenerationSettings } from "./GenerationSettings"

interface ProviderSettingsProps {
  providers: Provider[]
  disabled: boolean
  onSave: (provider: Provider, apiKey: string | null) => Promise<boolean>
  onDelete: (providerId: string) => Promise<boolean>
  onTest: (providerId: string) => Promise<boolean>
  onRefreshModels: (providerId: string) => Promise<boolean>
}

export function ProviderSettings({
  providers,
  disabled,
  onSave,
  onDelete,
  onTest,
  onRefreshModels,
}: ProviderSettingsProps) {
  const [draft, setDraft] = useState<Provider | null>(null)
  const [apiKey, setApiKey] = useState("")
  const [confirmDelete, setConfirmDelete] = useState(false)
  const deleteButton = useRef<HTMLButtonElement>(null)
  const cancelDeleteButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (confirmDelete) cancelDeleteButton.current?.focus()
  }, [confirmDelete])
  const stored = providers.find((provider) => provider.id === draft?.id)

  function select(provider: Provider | null) {
    setApiKey("")
    setConfirmDelete(false)
    setDraft(provider)
  }
  async function save() {
    if (draft && (await onSave(draft, apiKey || null))) setApiKey("")
  }
  async function remove() {
    if (stored && (await onDelete(stored.id))) select(null)
  }

  return (
    <section className="settings-section" aria-labelledby="provider-heading">
      <h3 id="provider-heading">プロバイダー</h3>
      <div className="settings-toolbar">
        <label htmlFor="provider-select">登録済みプロバイダー</label>
        <select
          id="provider-select"
          className="session-title-input"
          disabled={disabled}
          value={stored?.id ?? ""}
          onChange={(event) =>
            select(
              providers.find(
                (provider) => provider.id === event.target.value
              ) ?? null
            )
          }
        >
          <option value="">選択してください</option>
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() =>
            select({
              id: crypto.randomUUID(),
              name: "",
              base_url: "",
              authentication_mode: "none",
              credential_reference: null,
              timeout_seconds: 120,
              supports_usage: true,
              default_parameters: {},
              created_at: 0,
            })
          }
        >
          プロバイダーを追加
        </Button>
      </div>
      {providers.length === 0 && (
        <p className="settings-hint">
          プロバイダーを追加して、接続先と認証方式を設定してください。
        </p>
      )}
      {draft && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <fieldset disabled={disabled} className="settings-fields">
            <legend>
              {stored ? "プロバイダーの編集" : "新しいプロバイダー"}
            </legend>
            <label>
              名前
              <input
                className="session-title-input"
                required
                value={draft.name}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
              />
            </label>
            <label>
              Base URL
              <input
                className="session-title-input"
                type="url"
                required
                placeholder="https://api.example.com/v1"
                value={draft.base_url}
                onChange={(event) =>
                  setDraft({ ...draft, base_url: event.target.value })
                }
              />
            </label>
            <p className="settings-hint">
              OpenAI互換APIのルートURLを指定します。APIキーをURLに含めないでください。
            </p>
            <label>
              認証方式
              <select
                className="session-title-input"
                value={draft.authentication_mode}
                onChange={(event) => {
                  setApiKey("")
                  setDraft({
                    ...draft,
                    authentication_mode: event.target.value,
                  })
                }}
              >
                <option value="none">認証なし（ローカルサーバーなど）</option>
                <option value="bearer">Bearer APIキー</option>
              </select>
            </label>
            {draft.authentication_mode === "bearer" && (
              <label>
                APIキー
                <input
                  className="session-title-input"
                  type="password"
                  autoComplete="new-password"
                  spellCheck={false}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={
                    stored?.credential_reference
                      ? "登録済み（空欄なら保持）"
                      : "APIキーを入力"
                  }
                />
                <span className="settings-hint">
                  OSの資格情報ストアに保存します。既存キーは表示しません。空欄で保存すると既存キーを保持します。
                </span>
              </label>
            )}
            {stored?.credential_reference &&
              draft.authentication_mode === "none" && (
                <p className="settings-hint">
                  認証なしで保存すると、登録済みのAPIキーを削除します。
                </p>
              )}
            <label>
              タイムアウト（秒）
              <input
                className="session-title-input"
                type="number"
                required
                min={1}
                step={1}
                value={draft.timeout_seconds}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    timeout_seconds: event.target.valueAsNumber,
                  })
                }
              />
            </label>
            <label className="settings-checkbox">
              <input
                type="checkbox"
                checked={draft.supports_usage}
                onChange={(event) =>
                  setDraft({ ...draft, supports_usage: event.target.checked })
                }
              />
              ストリーミングでusageを要求する（include_usage）
            </label>
            <GenerationSettings
              id="provider-generation"
              value={draft.default_parameters}
              disabled={disabled}
              onChange={(default_parameters) =>
                setDraft({ ...draft, default_parameters })
              }
            />
            <div className="settings-actions">
              <Button type="submit">プロバイダーを保存</Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => select(null)}
              >
                閉じる
              </Button>
              {stored && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      void onTest(stored.id)
                    }}
                  >
                    接続テスト
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      void onRefreshModels(stored.id)
                    }}
                  >
                    モデル一覧を取得
                  </Button>
                  <Button
                    ref={deleteButton}
                    type="button"
                    variant="destructive"
                    onClick={() => setConfirmDelete(true)}
                  >
                    削除
                  </Button>
                </>
              )}
            </div>
            {stored && (
              <p className="settings-hint">
                接続テストとモデル取得には保存済みの設定を使います。変更した場合は先に保存してください。
              </p>
            )}
            {confirmDelete && stored && (
              <section
                className="settings-confirm"
                aria-label="プロバイダー削除の確認"
              >
                <p>
                  「{stored.name}
                  」と配下のモデルを削除します。取り消せません。生成履歴から参照されている場合や生成中は削除できません。
                </p>
                <div className="settings-actions">
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => {
                      void remove()
                    }}
                  >
                    削除する
                  </Button>
                  <Button
                    ref={cancelDeleteButton}
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setConfirmDelete(false)
                      deleteButton.current?.focus()
                    }}
                  >
                    キャンセル
                  </Button>
                </div>
              </section>
            )}
          </fieldset>
        </form>
      )}
    </section>
  )
}
