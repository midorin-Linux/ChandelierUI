import { formatMetric } from "../lib/analytics"
import { MetricCard } from "./MetricCard"

interface ContextUsageIndicatorProps {
  contextWindow: number | null
  inputTokens: number | null
  usagePercent: number | null
  remainingContext: number | null
}

export function ContextUsageIndicator({
  contextWindow,
  inputTokens,
  usagePercent,
  remainingContext,
}: ContextUsageIndicatorProps) {
  return (
    <section aria-labelledby="context-metrics-title" className="space-y-3">
      <h3 id="context-metrics-title" className="font-semibold">
        Context · 入力コンテキスト
      </h3>
      <dl className="metrics-grid">
        <MetricCard
          label="Context window"
          value={
            contextWindow === null
              ? "不明・未設定"
              : formatMetric(contextWindow, "tokens")
          }
        />
        <MetricCard
          label="Input tokens"
          value={formatMetric(inputTokens, "tokens")}
        />
        <MetricCard
          label="Context usage"
          value={formatMetric(usagePercent, "%")}
        />
        <MetricCard
          label="Remaining context"
          value={formatMetric(remainingContext, "tokens")}
        />
      </dl>
      <p className="text-xs leading-relaxed text-muted-foreground">
        選択したリクエストの API 入力トークン数と、実行時に設定されていた
        context window
        に基づく値です。入力欄のリアルタイム計測ではありません。残量は出力可能量の予測ではなく、報告値によって使用率が
        100% を超える場合もあります。
      </p>
    </section>
  )
}
