import { createWriteQueue } from "./writeQueue.ts"

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

const enqueue = createWriteQueue()
const order: string[] = []
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const slow = enqueue(async () => {
  await sleep(20)
  order.push("slow")
})
const failing = enqueue(async () => {
  order.push("failing")
  throw new Error("boom")
})
const last = enqueue(async () => {
  order.push("last")
  return 7
})
let failed = false
await failing.catch(() => (failed = true))
await slow
assert(failed, "A failed job rejects for its own caller")
assert((await last) === 7, "A later job still runs and returns its value")
assert(
  order.join() === "slow,failing,last",
  "Jobs run in call order, one at a time"
)
