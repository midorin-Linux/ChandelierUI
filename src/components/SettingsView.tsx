import type {
  AppError,
  AppPreferences,
  Bootstrap,
  GenerationParameters,
  Model,
  Provider,
  Session,
} from "../types/domain"
import { AppSettings } from "./AppSettings"
import { ModelSettings } from "./ModelSettings"
import { ProviderSettings } from "./ProviderSettings"
import { SessionSettings } from "./SessionSettings"
import { Button } from "./ui/button"

interface SettingsViewProps {
  data: Bootstrap
  session: Session | undefined
  sessionBusy: boolean
  generationActive: boolean
  pending: string | null
  error: AppError | null
  notice: string | null
  onBack: () => void
  onSaveProvider: (
    provider: Provider,
    apiKey: string | null
  ) => Promise<boolean>
  onDeleteProvider: (providerId: string) => Promise<boolean>
  onTestProvider: (providerId: string) => Promise<boolean>
  onRefreshModels: (providerId: string) => Promise<boolean>
  onSaveModel: (model: Model) => Promise<boolean>
  onDeleteModel: (modelId: string) => Promise<boolean>
  onSaveApp: (settings: AppPreferences) => Promise<boolean>
  onSaveSession: (
    session: Session,
    settings: GenerationParameters
  ) => Promise<boolean>
}

export function SettingsView({
  data,
  session,
  sessionBusy,
  generationActive,
  pending,
  error,
  notice,
  onBack,
  onSaveProvider,
  onDeleteProvider,
  onTestProvider,
  onRefreshModels,
  onSaveModel,
  onDeleteModel,
  onSaveApp,
  onSaveSession,
}: SettingsViewProps) {
  const disabled = pending !== null
  return (
    <section
      className="settings-view"
      aria-labelledby="settings-heading"
      aria-busy={disabled}
    >
      <header className="settings-toolbar">
        <h2 id="settings-heading">設定</h2>
        <Button type="button" variant="outline" onClick={onBack}>
          会話に戻る
        </Button>
      </header>
      <div className="settings-feedback" aria-live="polite">
        {pending && <p role="status">{pending}</p>}
        {notice && <p role="status">{notice}</p>}
        {error && (
          <p role="alert" className="text-destructive">
            {error.message}（{error.code}）
          </p>
        )}
        {generationActive && (
          <p className="settings-hint">
            生成はバックグラウンドで継続しています。生成中はプロバイダー・モデルの編集と削除を無効にしています。停止は会話画面で行えます。
          </p>
        )}
      </div>
      <p className="settings-hint">
        保存した設定は次の生成から適用されます。過去の生成パラメータと本文は変更しません。リクエスト固有の上書きはGenerateInput.parameters
        APIで指定できます。
      </p>
      <ProviderSettings
        providers={data.providers}
        disabled={disabled || generationActive}
        onSave={onSaveProvider}
        onDelete={onDeleteProvider}
        onTest={onTestProvider}
        onRefreshModels={onRefreshModels}
      />
      <ModelSettings
        models={data.models}
        providers={data.providers}
        disabled={disabled || generationActive}
        onSave={onSaveModel}
        onDelete={onDeleteModel}
      />
      <AppSettings
        key={JSON.stringify(data.settings)}
        settings={data.settings}
        dataDirectory={data.data_directory}
        disabled={disabled}
        onSave={onSaveApp}
      />
      {session ? (
        <SessionSettings
          key={`${session.id}:${JSON.stringify(session.session_settings)}`}
          session={session}
          disabled={disabled || sessionBusy}
          onSave={onSaveSession}
        />
      ) : (
        <p className="settings-hint">
          セッションを作成・選択すると、セッション固有の生成設定を編集できます。
        </p>
      )}
    </section>
  )
}
