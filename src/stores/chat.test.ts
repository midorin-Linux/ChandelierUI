import { isGenerating, useChatStore } from "./chat.ts"
import type { StreamEvent } from "../types/domain"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const store = useChatStore.getState()
const event: StreamEvent = {
  session_id: "a",
  generation_id: "generation-a",
  message_id: "assistant-a",
  sequence: 0,
  kind: "started",
  delta: null,
  metrics: null,
  error: null,
}
assert(store.begin("a", "request-a"), "First send should reserve its session")
assert(
  !store.begin("a", "duplicate"),
  "Duplicate sends must be blocked synchronously"
)
assert(
  store.begin("b", "request-b"),
  "Different sessions should be independent"
)
assert(
  !store.receive("request-b", event),
  "A different request must not receive this stream"
)
assert(
  store.receive("request-a", event),
  "Started should attach the generation"
)
assert(
  !store.receive("request-a", {
    ...event,
    sequence: 1,
    generation_id: "old",
    kind: "delta",
    delta: "wrong",
  }),
  "Stale generations must be ignored"
)
assert(
  store.receive("request-a", {
    ...event,
    sequence: 1,
    kind: "delta",
    delta: "日本語",
  }),
  "Delta should be accepted"
)
assert(
  !store.receive("request-a", {
    ...event,
    sequence: 1,
    kind: "delta",
    delta: "日本語",
  }),
  "Repeated sequences must not duplicate text"
)
assert(
  store.receive("request-a", {
    ...event,
    sequence: 2,
    kind: "delta",
    delta: "\ntext",
  }),
  "Later deltas should append"
)
assert(
  useChatStore.getState().sessions.a.generation?.content === "日本語\ntext",
  "Only channel deltas should form live text"
)
assert(
  store.receive("request-a", { ...event, sequence: 3, kind: "cancelled" }),
  "Cancellation should be terminal"
)
assert(
  !isGenerating(useChatStore.getState().sessions.a.generation),
  "Terminal events must release busy state"
)
assert(
  !store.receive("request-a", {
    ...event,
    sequence: 4,
    kind: "delta",
    delta: "late",
  }),
  "Late terminal deltas must be ignored"
)
assert(
  isGenerating(useChatStore.getState().sessions.b.generation),
  "Other sessions must remain busy"
)
assert(
  store.begin("a", "next-request"),
  "A terminal session should allow another generation"
)
store.fail("a", "request-a", { code: "ipc", message: "old" })
assert(
  isGenerating(useChatStore.getState().sessions.a.generation),
  "A previous invoke must not reset the new request"
)
store.fail("a", "next-request", { code: "ipc", message: "failed" })
assert(
  !isGenerating(useChatStore.getState().sessions.a.generation),
  "Failed invokes must release busy state"
)
assert(
  useChatStore.getState().sessions.a.error?.code === "ipc",
  "Failed invokes should retain typed errors"
)
assert(
  store.begin("a", "cancel-before-start"),
  "A failed session should allow another request"
)
store.fail("a", "cancel-before-start", {
  code: "cancelled",
  message: "cancelled",
})
assert(
  useChatStore.getState().sessions.a.generation?.status === "cancelled",
  "Cancellation before started must not become a failure"
)
assert(
  useChatStore.getState().sessions.a.error === null,
  "User cancellation should not show an error"
)
useChatStore.setState({ sessions: {} })
