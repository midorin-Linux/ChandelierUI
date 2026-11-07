import type { AnalyticsAttempt } from "../lib/analytics"
import { formatMetric } from "../lib/analytics"
import type { AppError, Generation, GenerationMetrics } from "../types/domain"
import { Button } from "./ui/button"
import { ContextUsageIndicator } from "./ContextUsageIndicator"
import { MetricCard } from "./MetricCard"

export interface AnalyticsPanelProps {
  attempts: AnalyticsAttempt[]
  selectedId: string | null
  selection: string | null
  generation: Generation | null
  status: string | null
  metrics: GenerationMetrics | null
  archived: boolean
  technical: {
    providerName: string | null
    modelName: string | null
    modelIdentifier: string | null
    endpointType: string | null
    baseUrl: string | null
  }
  output: string | null
  outputLoading: boolean
  outputError: AppError | null
  outputRefreshing: boolean
  onSelectGeneration: (id: string | null) => void
  onRetryOutput: () => void
}

export function AnalyticsPanel({
  attempts,
  selectedId,
  selection,
  generation,
  status,
  metrics,
  archived,
  technical,
  output,
  outputLoading,
  outputError,
  outputRefreshing,
  onSelectGeneration,
  onRetryOutput,
}: AnalyticsPanelProps) {
  return (
    <section
      id="analytics-panel"
      className="analytics-panel"
      aria-labelledby="analytics-title"
      tabIndex={-1}
    >
      <header className="space-y-3">
        <h2 id="analytics-title" className="text-lg font-semibold">
          生成の分析
        </h2>
        <label className="block space-y-1 text-sm">
          <span>生成履歴（過去の再生成・編集前の結果を含む）</span>
          <select
            className="session-title-input"
            value={selection ?? ""}
            disabled={attempts.length === 0}
            onChange={(event) => onSelectGeneration(event.target.value || null)}
          >
            <option value="">最新の生成（自動追従）</option>
            {attempts.map((attempt) => (
              <option key={attempt.id} value={attempt.id}>
                {new Date(attempt.startedAt).toLocaleString("ja-JP")} ·{" "}
                {attempt.status}
                {attempt.archived ? " · archived" : ""} · {attempt.id}
              </option>
            ))}
          </select>
        </label>
      </header>
      {selectedId === null ? (
        <p className="text-sm text-muted-foreground">
          生成を実行すると、ここに計測結果が表示されます。
        </p>
      ) : (
        <>
          <div className="space-y-1 text-sm [overflow-wrap:anywhere]">
            <p>
              Generation ID: <code>{selectedId}</code>
            </p>
            <p role="status">
              Status: {status ?? "未取得"}
              {archived ? " · archived（現在の会話には非表示）" : ""}
            </p>
            <p>Finish reason: {generation?.finish_reason ?? "未取得"}</p>
            {generation?.status === "failed" && generation.error && (
              <p className="text-destructive">
                {generation.error.message} ({generation.error.code})
              </p>
            )}
          </div>
          <section
            aria-labelledby="request-metrics-title"
            className="space-y-3"
          >
            <h3 id="request-metrics-title" className="font-semibold">
              Request · リクエスト
            </h3>
            <dl className="metrics-grid">
              <MetricCard
                label="Request latency"
                value={formatMetric(metrics?.request_latency_ms, "ms")}
                description="リクエスト開始 → HTTP 応答ヘッダー受信（エラー応答を含む）"
              />
              <MetricCard
                label="Time to first event"
                value={formatMetric(metrics?.first_event_ms, "ms")}
                description="開始 → 最初の非空 SSE data イベント。role のみのイベントも含みます。"
              />
              <MetricCard
                label="TTFT · Time to first content"
                value={formatMetric(metrics?.ttft_ms, "ms")}
                description="開始 → 最初の非空テキスト受信。ネットワーク・サーバー待機を含むクライアント観測値で、内部 prefill 時間ではありません。"
              />
              <MetricCard
                label="Generation duration"
                value={formatMetric(metrics?.generation_duration_ms, "ms")}
                description="最初 → 最後の非空テキスト受信。末尾の usage イベント待機は含みません。"
              />
              <MetricCard
                label="Total request duration"
                value={formatMetric(metrics?.total_duration_ms, "ms")}
                description="開始 → 完了・失敗・キャンセルの観測。最終保存時間は含みません。"
              />
              <MetricCard
                label="API-reported generation throughput"
                value={formatMetric(metrics?.generation_throughput, "tokens/s")}
                description="API 出力トークン数 ÷ Generation duration。reasoning 等の非表示出力を含む場合があり、可視テキスト TPS ではありません。"
              />
              <MetricCard
                label="Output TPS · visible text"
                value={formatMetric(metrics?.output_tps, "tokens/s")}
                description="正確な可視出力トークナイザーがないため未取得。文字数やイベント数から推測しません。"
              />
            </dl>
            <dl className="metrics-grid">
              <MetricCard
                label="Output tokens · API-reported"
                value={formatMetric(metrics?.output_tokens)}
              />
              <MetricCard
                label="Total tokens"
                value={formatMetric(metrics?.total_tokens)}
                description="API の合計値。未報告時は入力・出力の両方が取得できた場合のみ合算。"
              />
              <MetricCard
                label="Cached input tokens"
                value={formatMetric(metrics?.cached_tokens)}
              />
              <MetricCard
                label="Reasoning tokens"
                value={formatMetric(metrics?.reasoning_tokens)}
              />
            </dl>
            <p className="text-xs text-muted-foreground">
              未報告・未観測の値は「未取得」です。0
              とは区別します。途中の値は受信に応じて更新され、完了後は保存済みの値を表示します。
            </p>
          </section>
          <ContextUsageIndicator
            contextWindow={metrics?.context_window ?? null}
            inputTokens={metrics?.input_tokens ?? null}
            usagePercent={metrics?.context_usage_percent ?? null}
            remainingContext={metrics?.remaining_context ?? null}
          />
          <section
            aria-labelledby="technical-metrics-title"
            className="space-y-3"
          >
            <h3 id="technical-metrics-title" className="font-semibold">
              Technical · 実行時スナップショット
            </h3>
            <p className="text-xs text-muted-foreground">
              現在の設定ではなく、この生成を実行した時点の情報です。
            </p>
            {!generation && (
              <p role="status" className="text-sm text-muted-foreground">
                実行時の設定履歴を読み込み中…
              </p>
            )}
            <dl className="metrics-grid">
              <MetricCard
                label="Provider"
                value={technical.providerName ?? "未取得"}
              />
              <MetricCard
                label="Provider ID"
                value={generation?.provider_id ?? "未取得"}
              />
              <MetricCard
                label="Model"
                value={technical.modelName ?? "未取得"}
              />
              <MetricCard
                label="Model identifier · API"
                value={technical.modelIdentifier ?? "未取得"}
              />
              <MetricCard
                label="Model ID"
                value={generation?.model_id ?? "未取得"}
              />
              <MetricCard
                label="Endpoint type"
                value={technical.endpointType ?? "未取得"}
              />
              <MetricCard
                label="Base URL"
                value={technical.baseUrl ?? "未取得"}
              />
              <MetricCard
                label="Usage source"
                value={metrics?.usage_source ?? "unavailable"}
                description="api: API 報告値 / unavailable: 未取得。トークン数の推定は行いません。"
              />
            </dl>
            <h4 className="text-sm font-medium">
              Request parameters · 送信時のパラメーター
            </h4>
            <pre className="analytics-json">
              {generation
                ? JSON.stringify(generation.request_parameters, null, 2)
                : "未取得"}
            </pre>
          </section>
          {(selection !== null || archived) && (
            <section
              aria-labelledby="generation-output-title"
              className="space-y-3"
            >
              <h3 id="generation-output-title" className="font-semibold">
                選択した生成の出力{archived ? " · archived" : ""}
              </h3>
              {outputLoading ? (
                <p role="status" className="text-sm text-muted-foreground">
                  保存された出力を読み込み中…
                </p>
              ) : outputError ? (
                <div className="space-y-2">
                  <p role="alert" className="text-sm text-destructive">
                    出力を読み込めませんでした：{outputError.message}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={outputRefreshing}
                    onClick={onRetryOutput}
                  >
                    再読み込み
                  </Button>
                </div>
              ) : (
                <pre className="analytics-output">
                  {output === "" ? "（出力は空です）" : (output ?? "未取得")}
                </pre>
              )}
            </section>
          )}
        </>
      )}
    </section>
  )
}
