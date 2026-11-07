import { useEffect } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { sessionService } from "../lib/tauri"
import { useUiStore } from "../stores/ui"
import type {
  AppError,
  Bootstrap,
  Session,
  SessionDetail,
} from "../types/domain"

export const sessionKeys = {
  bootstrap: ["bootstrap"] as const,
  detail: (sessionId: string | null) => ["session", sessionId] as const,
}

export function useSessions() {
  const client = useQueryClient()
  const storedSelection = useUiStore((state) => state.selectedSessionId)
  const selectSession = useUiStore((state) => state.selectSession)
  const bootstrap = useQuery<Bootstrap, AppError>({
    queryKey: sessionKeys.bootstrap,
    queryFn: sessionService.bootstrap,
    retry: false,
  })
  const sessions = [...(bootstrap.data?.sessions ?? [])].sort(
    (a, b) => b.updated_at - a.updated_at
  )
  const selectedSessionId =
    sessions.find((session) => session.id === storedSelection)?.id ??
    sessions[0]?.id ??
    null
  useEffect(() => {
    if (storedSelection !== selectedSessionId) selectSession(selectedSessionId)
  }, [selectedSessionId, storedSelection, selectSession])
  const detail = useQuery<SessionDetail, AppError>({
    queryKey: sessionKeys.detail(selectedSessionId),
    queryFn: () => {
      if (selectedSessionId === null)
        throw new Error("セッションが選択されていません。")
      return sessionService.detail(selectedSessionId)
    },
    enabled: selectedSessionId !== null,
    retry: false,
  })
  const create = useMutation<Session, AppError, string>({
    mutationFn: sessionService.create,
    onSuccess: async (session) => {
      client.setQueryData<Bootstrap>(
        sessionKeys.bootstrap,
        (data) =>
          data && {
            ...data,
            sessions: [session, ...data.sessions],
          }
      )
      selectSession(session.id)
      await client.invalidateQueries({ queryKey: sessionKeys.bootstrap })
    },
  })
  const rename = useMutation<
    Session,
    AppError,
    { session: Session; title: string }
  >({
    mutationFn: ({ session, title }) =>
      sessionService.update({
        sessionId: session.id,
        title,
        modelId: session.selected_model_id,
        settings: session.session_settings,
      }),
    onSuccess: async (session) => {
      client.setQueryData<SessionDetail>(
        sessionKeys.detail(session.id),
        (data) => data && { ...data, session }
      )
      await client.invalidateQueries({ queryKey: sessionKeys.bootstrap })
    },
  })
  const remove = useMutation<void, AppError, string>({
    mutationFn: sessionService.delete,
    onSuccess: async (_, sessionId) => {
      client.setQueryData<Bootstrap>(
        sessionKeys.bootstrap,
        (data) =>
          data && {
            ...data,
            sessions: data.sessions.filter(
              (session) => session.id !== sessionId
            ),
          }
      )
      client.removeQueries({
        queryKey: sessionKeys.detail(sessionId),
        exact: true,
      })
      if (selectedSessionId === sessionId) selectSession(null)
      await client.invalidateQueries({ queryKey: sessionKeys.bootstrap })
    },
  })

  function clearMutationError() {
    create.reset()
    rename.reset()
    remove.reset()
  }

  return {
    bootstrap,
    detail,
    sessions,
    selectedSessionId,
    selectSession,
    create,
    rename,
    remove,
    clearMutationError,
    isMutating: create.isPending || rename.isPending || remove.isPending,
    mutationError: create.error ?? rename.error ?? remove.error,
  }
}
