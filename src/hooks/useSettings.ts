import { useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { normalizeError, sessionService, settingsService } from "../lib/tauri"
import { isGenerating, useChatStore } from "../stores/chat"
import type {
  AppError,
  AppPreferences,
  Bootstrap,
  GenerationParameters,
  Model,
  Provider,
  Session,
  SessionDetail,
} from "../types/domain"
import { sessionKeys } from "./useSessions"

export function useSettings() {
  const client = useQueryClient()
  const lock = useRef(false)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<AppError | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const generationActive = useChatStore((state) =>
    Object.values(state.sessions).some((chat) => isGenerating(chat.generation))
  )

  async function run(
    label: string,
    operation: () => Promise<unknown>,
    success: string
  ): Promise<boolean> {
    if (lock.current) return false
    lock.current = true
    setPending(label)
    setError(null)
    setNotice(null)
    try {
      await operation()
      await client.invalidateQueries({ queryKey: sessionKeys.bootstrap })
      setNotice(success)
      return true
    } catch (cause) {
      setError(normalizeError(cause))
      return false
    } finally {
      lock.current = false
      setPending(null)
    }
  }

  return {
    pending,
    error,
    notice,
    generationActive,
    saveProvider: (provider: Provider, apiKey: string | null) =>
      run(
        "プロバイダーを保存中…",
        () => settingsService.saveProvider(provider, apiKey),
        "プロバイダーを保存しました。"
      ),
    deleteProvider: (providerId: string) =>
      run(
        "プロバイダーを削除中…",
        async () => {
          await settingsService.deleteProvider(providerId)
          await client.invalidateQueries({ queryKey: ["session"] })
        },
        "プロバイダーを削除しました。"
      ),
    testProvider: (providerId: string) =>
      run(
        "接続をテスト中…",
        () => settingsService.testProvider(providerId),
        "保存済みの接続設定で接続できました。"
      ),
    refreshModels: (providerId: string) =>
      run(
        "モデル一覧を取得中…",
        () => settingsService.refreshModels(providerId),
        "モデル一覧を更新しました。既存の手動設定とキャッシュは保持されます。"
      ),
    saveModel: (model: Model) =>
      run(
        "モデルを保存中…",
        () => settingsService.saveModel(model),
        "モデルを保存しました。"
      ),
    deleteModel: (modelId: string) =>
      run(
        "モデルを削除中…",
        async () => {
          await settingsService.deleteModel(modelId)
          await client.invalidateQueries({ queryKey: ["session"] })
        },
        "モデルを削除しました。"
      ),
    saveApp: (settings: AppPreferences) =>
      run(
        "アプリ設定を保存中…",
        async () => {
          const saved = await settingsService.saveSettings(settings)
          client.setQueryData<Bootstrap>(
            sessionKeys.bootstrap,
            (data) => data && { ...data, settings: saved }
          )
        },
        "アプリ設定を保存しました。"
      ),
    saveSession: (session: Session, settings: GenerationParameters) =>
      run(
        "セッション設定を保存中…",
        async () => {
          const saved = await sessionService.update({
            sessionId: session.id,
            title: session.title,
            modelId: session.selected_model_id,
            settings,
          })
          client.setQueryData<SessionDetail>(
            sessionKeys.detail(session.id),
            (data) => data && { ...data, session: saved }
          )
          client.setQueryData<Bootstrap>(
            sessionKeys.bootstrap,
            (data) =>
              data && {
                ...data,
                sessions: data.sessions.map((item) =>
                  item.id === saved.id ? saved : item
                ),
              }
          )
        },
        "セッションの生成設定を保存しました。"
      ),
  }
}
