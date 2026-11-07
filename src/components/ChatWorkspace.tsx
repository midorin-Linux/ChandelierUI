import { useState } from "react"
import { useAnalytics } from "../hooks/useAnalytics"
import { useAutoScroll } from "../hooks/useAutoScroll"
import type { LiveGeneration } from "../stores/chat"
import type { SessionDetail } from "../types/domain"
import { AnalyticsPanel } from "./AnalyticsPanel"
import { ChatView, type ChatViewProps } from "./ChatView"
import { Button } from "./ui/button"

interface ChatWorkspaceProps {
  detail: SessionDetail
  live: LiveGeneration | null
  autoScroll: boolean
  visible: boolean
  chatView: Omit<ChatViewProps, "messagesRef">
}

export function ChatWorkspace({
  detail,
  live,
  autoScroll,
  visible,
  chatView,
}: ChatWorkspaceProps) {
  const [analyticsOpen, setAnalyticsOpen] = useState(false)
  const analytics = useAnalytics(detail, live)
  const lastMessage = chatView.messages[chatView.messages.length - 1]
  const messagesRef = useAutoScroll(
    autoScroll,
    detail.session.id,
    lastMessage?.id,
    lastMessage?.content,
    visible && !analyticsOpen
  )

  return (
    <div className="chat-workspace">
      <div className="flex items-center justify-end gap-3 border-b px-5 py-2">
        {!analyticsOpen && (
          <span className="mr-auto text-sm text-muted-foreground">会話</span>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-controls="analytics-panel"
          aria-expanded={analyticsOpen}
          onClick={() => setAnalyticsOpen((open) => !open)}
        >
          {analyticsOpen ? "会話に戻る" : "分析を表示"}
        </Button>
      </div>
      <div className="workspace-view" hidden={analyticsOpen}>
        <ChatView {...chatView} messagesRef={messagesRef} />
      </div>
      <div className="workspace-view" hidden={!analyticsOpen}>
        {analyticsOpen && (
          <a href="#analytics-panel" className="skip-link">
            分析結果へ移動
          </a>
        )}
        <AnalyticsPanel
          {...analytics}
          onSelectGeneration={analytics.selectGeneration}
          onRetryOutput={analytics.retryOutput}
        />
      </div>
    </div>
  )
}
