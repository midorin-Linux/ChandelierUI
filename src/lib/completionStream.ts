import type { ChatMessage, CompletionDelta } from "../types/chat.ts"

export interface CompletionStream {
  attemptId: number
  isPending: boolean
  message: ChatMessage | null
}

type StreamEvent =
  | { type: "start"; attemptId: number }
  | { type: "delta"; attemptId: number; delta: CompletionDelta }
  | { type: "finish"; attemptId: number; succeeded: boolean }

export function completionStream(
  state: CompletionStream,
  event: StreamEvent
): CompletionStream {
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
    },
  }
}
