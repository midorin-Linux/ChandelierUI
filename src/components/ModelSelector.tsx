import type { Model, Provider } from "../types/domain"

export interface ModelSelectorProps {
  models: Model[]
  providers: Provider[]
  value: string | null
  disabled: boolean
  onChange: (modelId: string) => void
}

export function ModelSelector({
  models,
  providers,
  value,
  disabled,
  onChange,
}: ModelSelectorProps) {
  const available = models.some((model) => model.id === value)
  return (
    <div className="space-y-1">
      <label htmlFor="chat-model" className="block text-sm font-medium">
        モデル
      </label>
      <select
        id="chat-model"
        className="session-title-input"
        value={available ? (value ?? "") : ""}
        disabled={disabled || models.length === 0}
        aria-describedby="chat-model-help"
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="" disabled>
          {models.length === 0
            ? "登録されたモデルがありません"
            : "モデルを選択してください"}
        </option>
        {models.map((model) => (
          <option key={model.id} value={model.id}>
            {providers.find((provider) => provider.id === model.provider_id)
              ?.name ?? "不明なプロバイダー"}{" "}
            / {model.display_name || model.model_identifier}
          </option>
        ))}
      </select>
      <p id="chat-model-help" className="text-xs text-muted-foreground">
        {models.length === 0
          ? "送信にはプロバイダーとモデルの登録が必要です。管理画面は次のフェーズで追加されます。"
          : "生成中はモデルを変更できません。"}
      </p>
    </div>
  )
}
