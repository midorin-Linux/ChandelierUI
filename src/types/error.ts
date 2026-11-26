/** Mirrors `crate::error::ErrorKind` in the backend. */
export type ErrorKind =
  | "database"
  | "notFound"
  | "invalidInput"
  | "keyring"
  | "preset"
  | "network"
  | "timeout"
  | "cancelled"
  | "httpStatus"
  | "invalidResponse"
  | "providerError"
  | "channel"

/** What a failed command rejects with. */
export interface IpcError {
  kind: ErrorKind
  message: string
}
