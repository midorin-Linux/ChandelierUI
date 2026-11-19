/** Runs jobs one at a time in call order; a failed job rejects for its caller only. */
export function createWriteQueue() {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(job: () => Promise<T>): Promise<T> => {
    const run = tail.then(job)
    tail = run.catch(() => undefined)
    return run
  }
}
