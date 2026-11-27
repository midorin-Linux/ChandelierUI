import type { ErrorKind } from "../types/error.ts"

export interface ErrorHint {
  hint: string
  /** The settings tab that fixes it, if any. */
  settings: "general" | "provider" | null
}

/** What to do about a failed request, from its error kind and HTTP status. */
export function errorHint(
  kind: ErrorKind | null,
  status: number | null
): ErrorHint {
  if (status === 401 || status === 403)
    return {
      hint: "The provider rejected the API key. Check or replace it in Provider settings.",
      settings: "provider",
    }
  if (status === 404)
    return {
      hint: "The endpoint or model was not found. Check the base URL and the model ID.",
      settings: "provider",
    }
  if (status === 429)
    return {
      hint: "The provider is rate limiting requests. Wait a moment, then retry.",
      settings: null,
    }
  if (status !== null && status >= 500)
    return {
      hint: "The provider had a server error. Retry in a moment.",
      settings: null,
    }
  if (status === 400 || status === 422)
    return {
      hint: "The provider rejected the request. The model may not support this effort; try another effort or model.",
      settings: null,
    }
  switch (kind) {
    case "network":
      return {
        hint: "Couldn't reach the provider. Check that the server is running and the base URL is right.",
        settings: "provider",
      }
    case "timeout":
      return {
        hint: "No data arrived before the timeout. Retry, or raise the timeout in General settings.",
        settings: "general",
      }
    case "keyring":
      return {
        hint: "The API key couldn't be read from the system keyring.",
        settings: "provider",
      }
    case "cancelled":
      return { hint: "The request was cancelled.", settings: null }
    case "invalidResponse":
    case "providerError":
      return {
        hint: "The provider sent an unexpected response. Check the model ID and that the endpoint is OpenAI-compatible.",
        settings: "provider",
      }
    default:
      return {
        hint: "Check the local server, provider URL, model ID, and effort support, then retry with the current settings.",
        settings: "provider",
      }
  }
}
