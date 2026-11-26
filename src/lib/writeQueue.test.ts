import assert from "node:assert/strict"
import { test } from "node:test"
import { createWriteQueue } from "./writeQueue.ts"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

test("jobs run one at a time in call order, and a failure stays with its caller", async () => {
  const enqueue = createWriteQueue()
  const order: string[] = []
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
})
