import type { MeasuredCompletion_Serialize as MeasuredCompletion } from "../bindings"
import type { Effort } from "./chat"
import type { ErrorKind } from "./error"

export type {
  CompletionMetrics_Serialize as CompletionMetrics,
  MeasuredCompletion_Serialize as MeasuredCompletion,
} from "../bindings"

/**
 * What is stored of a completion: the reply itself lives in the session tree.
 * Attempts stored before `error_kind` existed lack it.
 */
export type StoredCompletionResult = Omit<
  MeasuredCompletion,
  "message" | "error_kind"
> & { error_kind?: ErrorKind | null }

/** The request sent = system_prompt + pathToRoot(head_message_id). */
export interface AttemptRequest {
  base_url: string
  model: string
  reasoning_effort: Effort
  system_prompt: string
  head_message_id: string // the user message the request ended with
}

export interface CompletionAttempt {
  version: 1
  id: number
  started_at: string
  retry: boolean
  concurrency: number
  request: AttemptRequest
  context_length: number | null
  result: StoredCompletionResult
}
