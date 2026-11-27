import { Tabs, TabsList, TabsTrigger } from "@/src/components/ui/tabs"
import { efforts, type Effort } from "@/src/types/chat"

/** How each effort is sent; shown under the picker so the mapping is never a surprise. */
const effortHints: Record<Effort, string> = {
  off: "No reasoning. Sent as reasoning_effort “none”.",
  low: "Sent as reasoning_effort “low”.",
  medium: "Sent as reasoning_effort “medium”.",
  high: "Sent as reasoning_effort “high”.",
  xhigh: "Sent as reasoning_effort “xhigh”.",
  max: "The most the API accepts. Sent as reasoning_effort “xhigh”.",
}

/**
 * The six efforts side by side, used both for a chat and for new-chat defaults.
 * `labelledBy` names the visible label; the hint is linked with `hintId`.
 */
export function EffortPicker({
  value,
  onChange,
  labelledBy,
  hintId,
}: {
  value: Effort
  onChange: (effort: Effort) => void
  labelledBy: string
  hintId: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Tabs
        value={value}
        onValueChange={(next) => {
          const effort = efforts.find((e) => e === next)
          if (effort) onChange(effort)
        }}
      >
        <TabsList
          aria-labelledby={labelledBy}
          aria-describedby={hintId}
          className="w-full"
        >
          {efforts.map((effort) => (
            <TabsTrigger key={effort} value={effort} className="capitalize">
              {effort}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <p id={hintId} className="text-xs text-muted-foreground">
        {effortHints[value]}
      </p>
    </div>
  )
}
