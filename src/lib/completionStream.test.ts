import { completionStream, type CompletionStream } from "./completionStream.ts"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

let state: CompletionStream = {
  attemptId: 0,
  isPending: false,
  message: null,
}
state = completionStream(state, { type: "start", attemptId: 1 })
const delta = { content: "", reasoning: "Checking " }
state = completionStream(state, { type: "delta", attemptId: 1, delta })
state = completionStream(state, {
  type: "delta",
  attemptId: 1,
  delta: { content: "Answer", reasoning: "the source" },
})
assert(
  state.message?.content === "Answer" &&
    state.message.reasoning === "Checking the source",
  "Content and reasoning accumulate independently"
)
state = completionStream(state, {
  type: "finish",
  attemptId: 1,
  succeeded: false,
})
assert(
  !state.isPending && state.message?.content === "Answer",
  "Failure preserves partial output separately from history"
)
assert(
  completionStream(state, { type: "delta", attemptId: 1, delta }) === state,
  "Late data after failure cannot rewrite partial output"
)
state = completionStream(state, { type: "start", attemptId: 2 })
assert(
  state.isPending && state.message === null,
  "Retry clears old partial output"
)
assert(
  completionStream(state, { type: "delta", attemptId: 1, delta }) === state,
  "Old attempt deltas cannot modify a new attempt"
)
assert(
  completionStream(state, {
    type: "finish",
    attemptId: 1,
    succeeded: true,
  }) === state,
  "Old attempt completion cannot finish a new attempt"
)
assert(
  completionStream(state, {
    type: "delta",
    attemptId: 2,
    delta: { content: "", reasoning: "" },
  }) === state,
  "Empty deltas do not create empty messages"
)
state = completionStream(state, { type: "delta", attemptId: 2, delta })
state = completionStream(state, {
  type: "finish",
  attemptId: 2,
  succeeded: true,
})
assert(
  !state.isPending && state.message === null,
  "Success removes the partial when the final message replaces it"
)
assert(
  completionStream(state, { type: "delta", attemptId: 2, delta }) === state,
  "Late data after success cannot resurrect a duplicate message"
)

assert(
  completionStream(
    {
      attemptId: 4,
      isPending: false,
      message: { role: "assistant", content: "x" },
    },
    { type: "reset" }
  ).message === null,
  "Reset must drop a failed partial message when switching sessions"
)
