import { useSyncExternalStore } from "react"
import {
  CircleAlertIcon,
  CircleCheckIcon,
  LoaderCircleIcon,
} from "lucide-react"
import { settingsWriter } from "@/src/lib/api"

/** Settings save as they change; this says whether they have. */
export function SaveStatus() {
  const { pending, error } = useSyncExternalStore(
    settingsWriter.subscribe,
    settingsWriter.status
  )
  return (
    <p
      role="status"
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
    >
      {error ? (
        <span
          className="flex items-center gap-1.5 text-destructive"
          title={error}
        >
          <CircleAlertIcon className="size-3.5" />
          Couldn&apos;t save: {error}
        </span>
      ) : pending > 0 ? (
        <>
          <LoaderCircleIcon className="size-3.5 animate-spin" />
          Saving…
        </>
      ) : (
        <>
          <CircleCheckIcon className="size-3.5" />
          Changes are saved automatically
        </>
      )}
    </p>
  )
}
