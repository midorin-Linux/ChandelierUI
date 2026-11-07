import { useEffect, useRef } from "react"

export function useAutoScroll(
  enabled: boolean,
  sessionId: string | null,
  lastMessageId: string | undefined,
  content: string | undefined,
  visible: boolean
) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (enabled && visible && ref.current)
      ref.current.scrollTop = ref.current.scrollHeight
  }, [enabled, sessionId, lastMessageId, content, visible])
  return ref
}
