import { useMutation, useQueryClient } from "@tanstack/react-query"
import { generationService, normalizeError, sessionService } from "../lib/tauri"
import { emptyChat, isGenerating, useChatStore } from "../stores/chat"
import type {
  AppError,
  Bootstrap,
  GenerateInput,
  Message,
  Model,
  Session,
  SessionDetail,
} from "../types/domain"
import { sessionKeys } from "./useSessions"

export function useChat(
  detail: SessionDetail | undefined,
  models: Model[],
  disabled: boolean
) {
  const client = useQueryClient()
  const sessionId = detail?.session.id ?? null
  const chat = useChatStore((state) =>
    sessionId ? (state.sessions[sessionId] ?? emptyChat) : emptyChat
  )
  const patch = useChatStore((state) => state.patch)
  const busy = isGenerating(chat.generation)
  const hasModel = models.some(
    (model) => model.id === detail?.session.selected_model_id
  )

  async function refresh(id: string) {
    await Promise.all([
      client.invalidateQueries({ queryKey: sessionKeys.detail(id) }),
      client.invalidateQueries({ queryKey: sessionKeys.bootstrap }),
    ])
  }

  const modelChange = useMutation<
    Session,
    AppError,
    { session: Session; modelId: string }
  >({
    mutationFn: ({ session, modelId }) =>
      sessionService.update({
        sessionId: session.id,
        title: session.title,
        modelId,
        settings: session.session_settings,
      }),
    onSuccess: async (session) => {
      client.setQueryData<SessionDetail>(
        sessionKeys.detail(session.id),
        (data) => data && { ...data, session }
      )
      client.setQueryData<Bootstrap>(
        sessionKeys.bootstrap,
        (data) =>
          data && {
            ...data,
            sessions: data.sessions.map((item) =>
              item.id === session.id ? session : item
            ),
          }
      )
      await refresh(session.id)
    },
    onError: (error, { session }) => patch(session.id, { error }),
  })

  async function generate(
    action: GenerateInput["action"],
    content: string | null,
    messageId: string | null = null
  ) {
    if (
      !detail ||
      disabled ||
      modelChange.isPending ||
      !hasModel ||
      (action !== "regenerate" && !content?.trim())
    )
      return
    const id = detail.session.id
    const requestId = crypto.randomUUID()
    const store = useChatStore.getState()
    if (!store.begin(id, requestId)) return
    try {
      await generationService.generate(
        {
          session_id: id,
          action,
          content,
          message_id: messageId,
          parameters: {},
        },
        (event) => {
          if (
            event.session_id !== id ||
            !useChatStore.getState().receive(requestId, event)
          )
            return
          if (event.kind === "started") {
            patch(id, action === "send" ? { draft: "" } : { editing: null })
            void refresh(id)
          }
        }
      )
      const generation = useChatStore.getState().sessions[id]?.generation
      if (generation?.requestId === requestId && isGenerating(generation)) {
        store.fail(id, requestId, {
          code: "disconnected",
          message:
            "生成の完了を確認できませんでした。履歴を再読み込みしてください。",
        })
        void generationService.cancel(id).catch(() => {})
      }
    } catch (error) {
      const generation = useChatStore.getState().sessions[id]?.generation
      if (generation?.requestId === requestId && isGenerating(generation)) {
        const appError = normalizeError(error)
        store.fail(id, requestId, appError)
        if (generation.generationId !== null || appError.code === "ipc")
          void generationService.cancel(id).catch(() => {})
      }
    } finally {
      await refresh(id)
    }
  }

  async function stop() {
    const generation = chat.generation
    if (!sessionId || !generation || !busy || generation.cancelling) return
    patch(sessionId, {
      generation: { ...generation, cancelling: true },
      error: null,
    })
    try {
      await generationService.cancel(sessionId)
    } catch (error) {
      const current = useChatStore.getState().sessions[sessionId]?.generation
      if (current?.requestId === generation.requestId) {
        patch(sessionId, {
          generation: { ...current, cancelling: false },
          error: normalizeError(error),
        })
      }
      await refresh(sessionId)
    }
  }

  async function copy(message: Message) {
    if (!sessionId) return
    patch(sessionId, { notice: null, error: null })
    try {
      await navigator.clipboard.writeText(message.content)
      patch(sessionId, { notice: "メッセージをコピーしました。" })
    } catch {
      patch(sessionId, {
        error: {
          code: "clipboard",
          message: "コピーできませんでした。本文を選択してコピーしてください。",
        },
      })
    }
  }

  let messages = detail?.messages ?? []
  const live = chat.generation
  if (live?.messageId) {
    const persisted = messages.find((message) => message.id === live.messageId)
    const content =
      !busy && persisted && persisted.content.length > live.content.length
        ? persisted.content
        : live.content
    const message: Message = {
      id: live.messageId,
      session_id: sessionId ?? "",
      role: "assistant",
      content,
      status: live.status,
      created_at: persisted?.created_at ?? live.startedAt,
      updated_at: persisted?.updated_at ?? live.startedAt,
      ordinal:
        persisted?.ordinal ??
        (messages[messages.length - 1]?.ordinal ?? -1) + 1,
      active: true,
    }
    messages = persisted
      ? messages.map((item) => (item.id === message.id ? message : item))
      : [...messages, message]
  }
  const latest = messages[messages.length - 1]

  return {
    ...chat,
    error:
      chat.error ??
      detail?.generations.find(
        (generation) =>
          generation.message_id === latest?.id && generation.status === "failed"
      )?.error ??
      null,
    messages,
    busy,
    hasModel,
    isModelUpdating: modelChange.isPending,
    canRegenerate:
      latest?.role === "assistant" &&
      messages.some((message) => message.role === "user"),
    setDraft: (draft: string) => {
      if (sessionId) patch(sessionId, { draft })
    },
    send: () => {
      void generate("send", chat.draft)
    },
    regenerate: () => {
      if (latest?.role === "assistant") void generate("regenerate", null)
    },
    stop: () => {
      void stop()
    },
    copy: (message: Message) => {
      void copy(message)
    },
    startEdit: (message: Message) => {
      if (sessionId && !busy && !disabled && !modelChange.isPending)
        patch(sessionId, {
          editing: { messageId: message.id, content: message.content },
          notice: null,
        })
    },
    setEditContent: (content: string) => {
      if (sessionId && chat.editing)
        patch(sessionId, { editing: { ...chat.editing, content } })
    },
    cancelEdit: () => {
      if (sessionId) patch(sessionId, { editing: null })
    },
    submitEdit: () => {
      if (chat.editing)
        void generate("edit", chat.editing.content, chat.editing.messageId)
    },
    selectModel: (modelId: string) => {
      if (
        !detail ||
        busy ||
        disabled ||
        modelChange.isPending ||
        !models.some((model) => model.id === modelId)
      )
        return
      patch(detail.session.id, { error: null })
      modelChange.mutate({ session: detail.session, modelId })
    },
  }
}
