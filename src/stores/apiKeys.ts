import { useEffect } from "react"
import { create } from "zustand"
import { desktop, hasApiKey } from "@/src/lib/api"

/**
 * Whether each provider has a key in the system keyring, keyed by provider id.
 * Checked once per id, so opening settings doesn't hit the keyring each time.
 * The key itself never reaches the frontend.
 */
const useApiKeyStore = create<Record<string, boolean>>(() => ({}))
const checking = new Set<string>()

/** Records a save (true) or deletion (false). */
export const markApiKey = (providerId: string, saved: boolean) =>
  useApiKeyStore.setState({ [providerId]: saved })

/** True, false, or null while the keyring is being checked. Rejections go to `onError`. */
export function useHasApiKey(
  providerId: string,
  onError?: (cause: unknown) => void
): boolean | null {
  const saved = useApiKeyStore((s) => s[providerId])
  useEffect(() => {
    // The browser preview has no keyring.
    if (!desktop || checking.has(providerId)) return
    if (useApiKeyStore.getState()[providerId] !== undefined) return
    checking.add(providerId)
    hasApiKey(providerId)
      .then((value) => markApiKey(providerId, value))
      .catch((cause) => onError?.(cause))
      .finally(() => checking.delete(providerId))
  }, [providerId, onError])
  if (!desktop) return false
  return saved ?? null
}
