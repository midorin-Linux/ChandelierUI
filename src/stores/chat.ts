import { create } from "zustand"
import type { AppError, GenerationMetrics, StreamEvent } from "../types/domain"

export type GenerationStatus =
  "pending" | "streaming" | "completed" | "cancelled" | "failed"

export interface LiveGeneration {
  requestId: string
  generationId: string | null
  messageId: string | null
  sequence: number
  startedAt: number
  status: GenerationStatus
  content: string
  metrics: GenerationMetrics | null
  cancelling: boolean
}

export interface ChatState {
  draft: string
  editing: { messageId: string; content: string } | null
  generation: LiveGeneration | null
  error: AppError | null
  notice: string | null
}

export const emptyChat: ChatState = {
  draft: "",
  editing: null,
  generation: null,
  error: null,
  notice: null,
}
export const isGenerating = (generation: LiveGeneration | null) =>
  generation?.status === "pending" || generation?.status === "streaming"

export function applyStreamEvent(
  generation: LiveGeneration,
  event: StreamEvent
): LiveGeneration {
  if (!isGenerating(generation) || event.sequence <= generation.sequence)
    return generation
  if (
    generation.generationId !== null &&
    generation.generationId !== event.generation_id
  )
    return generation
  if (generation.generationId === null && event.kind !== "started")
    return generation
  return {
    ...generation,
    generationId: event.generation_id,
    messageId: event.message_id ?? generation.messageId,
    sequence: event.sequence,
    status:
      event.kind === "completed"
        ? "completed"
        : event.kind === "cancelled"
          ? "cancelled"
          : event.kind === "error"
            ? "failed"
            : "streaming",
    content:
      event.kind === "delta"
        ? generation.content + (event.delta ?? "")
        : generation.content,
    metrics: event.metrics ?? generation.metrics,
  }
}

interface ChatStore {
  sessions: Record<string, ChatState>
  patch: (sessionId: string, patch: Partial<ChatState>) => void
  begin: (sessionId: string, requestId: string) => boolean
  receive: (requestId: string, event: StreamEvent) => boolean
  fail: (sessionId: string, requestId: string, error: AppError) => void
}

export const useChatStore = create<ChatStore>((set, get) => ({
  sessions: {},
  patch: (sessionId, patch) =>
    set((state) => ({
      sessions: {
        ...state.sessions,
        [sessionId]: { ...(state.sessions[sessionId] ?? emptyChat), ...patch },
      },
    })),
  begin: (sessionId, requestId) => {
    if (isGenerating(get().sessions[sessionId]?.generation ?? null))
      return false
    get().patch(sessionId, {
      error: null,
      notice: null,
      generation: {
        requestId,
        generationId: null,
        messageId: null,
        sequence: -1,
        startedAt: Date.now(),
        status: "pending",
        content: "",
        metrics: null,
        cancelling: false,
      },
    })
    return true
  },
  receive: (requestId, event) => {
    const chat = get().sessions[event.session_id]
    if (!chat?.generation || chat.generation.requestId !== requestId)
      return false
    const generation = applyStreamEvent(chat.generation, event)
    if (generation === chat.generation) return false
    get().patch(event.session_id, {
      generation,
      ...(event.kind === "error"
        ? {
            error: event.error ?? {
              code: "generation",
              message: "生成に失敗しました。",
            },
          }
        : {}),
    })
    return true
  },
  fail: (sessionId, requestId, error) => {
    const generation = get().sessions[sessionId]?.generation
    if (generation?.requestId !== requestId) return
    get().patch(sessionId, {
      generation: {
        ...generation,
        status: error.code === "cancelled" ? "cancelled" : "failed",
        cancelling: false,
      },
      error: error.code === "cancelled" ? null : error,
    })
  },
}))
