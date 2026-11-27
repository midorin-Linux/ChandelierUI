import type { ChatMessage, CompletionDelta } from "../types/chat.ts"

/** The reply so far; `reasoning_ms` is set once thinking has ended. */
export type StreamMessage = ChatMessage & { reasoning_ms?: number }

export interface CompletionStream {
  attemptId: number
  isPending: boolean
  message: StreamMessage | null
}

type StreamEvent =
  | { type: "start"; attemptId: number }
  | {
      type: "delta"
      attemptId: number
      delta: CompletionDelta
      /** Thinking time, sent with the first content that follows reasoning. */
      reasoningMs?: number
    }
  | { type: "finish"; attemptId: number; succeeded: boolean }
  | { type: "reset" }

export function completionStream(
  state: CompletionStream,
  event: StreamEvent
): CompletionStream {
  if (event.type === "reset") {
    return { attemptId: 0, isPending: false, message: null }
  }
  if (event.type === "start") {
    return { attemptId: event.attemptId, isPending: true, message: null }
  }
  if (state.attemptId !== event.attemptId || !state.isPending) return state
  if (event.type === "finish") {
    return {
      ...state,
      isPending: false,
      message: event.succeeded ? null : state.message,
    }
  }
  if (!event.delta.content && !event.delta.reasoning) return state
  return {
    ...state,
    message: {
      role: "assistant",
      content: (state.message?.content ?? "") + event.delta.content,
      reasoning: (state.message?.reasoning ?? "") + event.delta.reasoning,
      ...((event.reasoningMs ?? state.message?.reasoning_ms) !== undefined && {
        reasoning_ms: event.reasoningMs ?? state.message?.reasoning_ms,
      }),
    },
  }
}
