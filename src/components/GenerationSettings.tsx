import type {
  GenerationParameter,
  GenerationParameters,
  NumericParameter,
} from "../types/domain"
import { Textarea } from "./ui/textarea"

export const numericParameters: {
  key: NumericParameter
  label: string
  min: number
  max: number
  step: number
  initial: number
}[] = [
  {
    key: "temperature",
    label: "Temperature",
    min: 0,
    max: 2,
    step: 0.01,
    initial: 1,
  },
  { key: "top_p", label: "Top P", min: 0, max: 1, step: 0.01, initial: 1 },
  {
    key: "max_completion_tokens",
    label: "Max Completion Tokens",
    min: 1,
    max: 2147483647,
    step: 1,
    initial: 1024,
  },
  {
    key: "frequency_penalty",
    label: "Frequency Penalty",
    min: -2,
    max: 2,
    step: 0.01,
    initial: 0,
  },
  {
    key: "presence_penalty",
    label: "Presence Penalty",
    min: -2,
    max: 2,
    step: 0.01,
    initial: 0,
  },
]

interface GenerationSettingsProps {
  id: string
  value: GenerationParameters
  disabled: boolean
  onChange: (value: GenerationParameters) => void
}

export function GenerationSettings({
  id,
  value,
  disabled,
  onChange,
}: GenerationSettingsProps) {
  function mode(key: GenerationParameter) {
    return value[key] === undefined
      ? "inherit"
      : value[key] === null
        ? "remove"
        : "custom"
  }
  function changeMode(key: GenerationParameter, next: string) {
    const updated = { ...value }
    if (next === "inherit") delete updated[key]
    else if (next === "remove") updated[key] = null
    else if (key === "system_prompt") updated.system_prompt = ""
    else
      updated[key] =
        numericParameters.find((field) => field.key === key)?.initial ?? 0
    onChange(updated)
  }
  const fields: { key: GenerationParameter; label: string }[] = [
    { key: "system_prompt", label: "System Prompt" },
    ...numericParameters,
  ]
  return (
    <fieldset disabled={disabled} className="generation-fields">
      <legend className="font-medium">生成パラメータ</legend>
      <p className="settings-hint">
        継承＝この階層では未指定。解除＝継承値を送信しない（API側の既定値）。優先順はアプリ
        → プロバイダー → モデル → セッション → リクエストです。
      </p>
      {fields.map(({ key, label }) => {
        const numeric = numericParameters.find((field) => field.key === key)
        return (
          <div key={key} className="generation-field">
            <label htmlFor={`${id}-${key}-mode`}>{label}</label>
            <select
              id={`${id}-${key}-mode`}
              className="session-title-input"
              value={mode(key)}
              onChange={(event) => changeMode(key, event.target.value)}
            >
              <option value="inherit">継承（未指定）</option>
              <option value="custom">値を指定</option>
              <option value="remove">継承を解除（null）</option>
            </select>
            {mode(key) === "custom" &&
              (key === "system_prompt" ? (
                <Textarea
                  aria-label={label}
                  value={value.system_prompt ?? ""}
                  onChange={(event) =>
                    onChange({ ...value, system_prompt: event.target.value })
                  }
                  rows={3}
                />
              ) : (
                numeric && (
                  <input
                    aria-label={label}
                    className="session-title-input"
                    type="number"
                    required
                    min={numeric.min}
                    max={numeric.max}
                    step={numeric.step}
                    value={value[key] ?? ""}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        [key]:
                          event.target.value === ""
                            ? undefined
                            : event.target.valueAsNumber,
                      })
                    }
                  />
                )
              ))}
          </div>
        )
      })}
    </fieldset>
  )
}
