import { useEffect, useRef, useState } from "react"
import type { Model, Provider } from "../types/domain"
import { Button } from "./ui/button"
import { GenerationSettings, numericParameters } from "./GenerationSettings"

interface ModelSettingsProps {
  models: Model[]
  providers: Provider[]
  disabled: boolean
  onSave: (model: Model) => Promise<boolean>
  onDelete: (modelId: string) => Promise<boolean>
}

export function ModelSettings({
  models,
  providers,
  disabled,
  onSave,
  onDelete,
}: ModelSettingsProps) {
  const [draft, setDraft] = useState<Model | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const deleteButton = useRef<HTMLButtonElement>(null)
  const cancelDeleteButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (confirmDelete) cancelDeleteButton.current?.focus()
  }, [confirmDelete])
  const stored = models.find((model) => model.id === draft?.id)
  async function remove() {
    if (stored && (await onDelete(stored.id))) {
      setDraft(null)
      setConfirmDelete(false)
    }
  }
  return (
    <section className="settings-section" aria-labelledby="model-heading">
      <h3 id="model-heading">モデル</h3>
      <div className="settings-toolbar">
        <label htmlFor="settings-model-select">保存済み・取得済みモデル</label>
        <select
          id="settings-model-select"
          className="session-title-input"
          disabled={disabled}
          value={stored?.id ?? ""}
          onChange={(event) => {
            setDraft(
              models.find((model) => model.id === event.target.value) ?? null
            )
            setConfirmDelete(false)
          }}
        >
          <option value="">選択してください</option>
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {providers.find((provider) => provider.id === model.provider_id)
                ?.name ?? "不明な接続先"}{" "}
              / {model.display_name}（
              {model.context_window === null
                ? "コンテキスト長不明"
                : `${model.context_window.toLocaleString()} tokens`}
              ）
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || providers.length === 0}
          onClick={() => {
            setDraft({
              id: crypto.randomUUID(),
              provider_id: providers[0]?.id ?? "",
              model_identifier: "",
              display_name: "",
              context_window: null,
              capabilities: {},
              default_parameters: {},
            })
            setConfirmDelete(false)
          }}
        >
          モデルを手動追加
        </Button>
      </div>
      <p className="settings-hint">
        モデル一覧はプロバイダーの「モデル一覧を取得」で更新できます。取得済みモデルはローカルに保持されます。会話での選択は会話上部で行い、最後に選択したモデルを次のセッションにも使います。
      </p>
      {draft && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void onSave(draft)
          }}
        >
          <fieldset disabled={disabled} className="settings-fields">
            <legend>{stored ? "モデルの編集" : "新しいモデル"}</legend>
            <label>
              プロバイダー
              <select
                className="session-title-input"
                required
                disabled={!!stored}
                value={draft.provider_id}
                onChange={(event) =>
                  setDraft({ ...draft, provider_id: event.target.value })
                }
              >
                <option value="">選択してください</option>
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              モデル識別子
              <input
                className="session-title-input"
                required
                disabled={!!stored}
                value={draft.model_identifier}
                onChange={(event) =>
                  setDraft({ ...draft, model_identifier: event.target.value })
                }
              />
            </label>
            {stored && (
              <p className="settings-hint">
                過去の生成の再現性を守るため、保存済みモデルのプロバイダーと識別子は変更できません。別のモデルとして追加してください。
              </p>
            )}
            <label>
              表示名
              <input
                className="session-title-input"
                required
                value={draft.display_name}
                onChange={(event) =>
                  setDraft({ ...draft, display_name: event.target.value })
                }
              />
            </label>
            <label>
              コンテキスト長（tokens）
              <input
                className="session-title-input"
                type="number"
                min={1}
                step={1}
                placeholder="不明（未設定）"
                value={draft.context_window ?? ""}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    context_window:
                      event.target.value === ""
                        ? null
                        : event.target.valueAsNumber,
                  })
                }
              />
            </label>
            <p className="settings-hint">
              不明なら空欄のままにしてください。推測値は設定しません。
            </p>
            <GenerationSettings
              id="model-generation"
              value={draft.default_parameters}
              disabled={disabled}
              onChange={(default_parameters) =>
                setDraft({ ...draft, default_parameters })
              }
            />
            <fieldset className="settings-fields">
              <legend>APIのパラメータ互換性</legend>
              <p className="settings-hint">
                非対応の項目にチェックすると、継承した値もAPIに送信しません。System
                Promptは常に対応します。
              </p>
              {numericParameters.map(({ key, label }) => (
                <label className="settings-checkbox" key={key}>
                  <input
                    type="checkbox"
                    checked={
                      draft.capabilities.unsupported_parameters?.includes(
                        key
                      ) ?? false
                    }
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        capabilities: {
                          ...draft.capabilities,
                          unsupported_parameters: event.target.checked
                            ? [
                                ...(draft.capabilities.unsupported_parameters ??
                                  []),
                                key,
                              ]
                            : (
                                draft.capabilities.unsupported_parameters ?? []
                              ).filter((parameter) => parameter !== key),
                        },
                      })
                    }
                  />
                  {label} は非対応
                </label>
              ))}
              <label>
                最大出力トークン数の送信名
                <select
                  className="session-title-input"
                  value={
                    draft.capabilities.max_tokens_parameter ??
                    "max_completion_tokens"
                  }
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      capabilities: {
                        ...draft.capabilities,
                        max_tokens_parameter:
                          event.target.value === "max_tokens"
                            ? "max_tokens"
                            : "max_completion_tokens",
                      },
                    })
                  }
                >
                  <option value="max_completion_tokens">
                    max_completion_tokens
                  </option>
                  <option value="max_tokens">max_tokens（互換API向け）</option>
                </select>
              </label>
            </fieldset>
            <div className="settings-actions">
              <Button type="submit">モデルを保存</Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setDraft(null)
                  setConfirmDelete(false)
                }}
              >
                閉じる
              </Button>
              {stored && (
                <Button
                  ref={deleteButton}
                  type="button"
                  variant="destructive"
                  onClick={() => setConfirmDelete(true)}
                >
                  削除
                </Button>
              )}
            </div>
            {confirmDelete && stored && (
              <section
                className="settings-confirm"
                aria-label="モデル削除の確認"
              >
                <p>
                  「{stored.display_name}
                  」を削除します。取り消せません。生成履歴で使われたモデルや生成中のモデルは削除できません。
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
