import type { LiveGeneration } from "../stores/chat"
import type {
  Generation,
  GenerationMetrics,
  SessionDetail,
} from "../types/domain"

export interface AnalyticsAttempt {
  id: string
  startedAt: number
  status: string
  archived: boolean
}

export function selectAnalytics(
  detail: SessionDetail,
  live: LiveGeneration | null,
  selection: string | null
) {
  const activeMessageIds = new Set<string>()
  for (const message of detail.messages) activeMessageIds.add(message.id)
  const attempts: AnalyticsAttempt[] = detail.generations.map((generation) => ({
    id: generation.id,
    startedAt: generation.started_at,
    status:
      generation.id === live?.generationId &&
      (generation.status === "pending" || generation.status === "streaming")
        ? live.status
        : generation.status,
    archived: !activeMessageIds.has(generation.message_id),
  }))
  if (
    live?.generationId &&
    !attempts.some((attempt) => attempt.id === live.generationId)
  ) {
    attempts.push({
      id: live.generationId,
      startedAt: live.startedAt,
      status: live.status,
      archived: false,
    })
  }
  attempts.sort((a, b) => b.startedAt - a.startedAt || b.id.localeCompare(a.id))
  const latestVisible = detail.generations.find(
    (item) =>
      item.message_id === detail.messages[detail.messages.length - 1]?.id
  )
  const latestId =
    live?.generationId &&
    (!latestVisible || live.startedAt >= latestVisible.started_at)
      ? live.generationId
      : (latestVisible?.id ?? attempts[0]?.id ?? null)
  const selectedId =
    attempts.find((attempt) => attempt.id === selection)?.id ?? latestId
  const generation: Generation | null =
    detail.generations.find((item) => item.id === selectedId) ?? null
  const selectedLive =
    selectedId !== null && live?.generationId === selectedId ? live : null
  const persistedMetrics =
    detail.metrics.find((item) => item.generation_id === selectedId) ?? null
  const persistedTerminal =
    generation !== null &&
    generation.status !== "pending" &&
    generation.status !== "streaming"
  const metrics: GenerationMetrics | null = persistedTerminal
    ? (persistedMetrics ?? selectedLive?.metrics ?? null)
    : (selectedLive?.metrics ?? persistedMetrics)
  const activeMessage =
    detail.messages.find((message) => message.id === generation?.message_id) ??
    null
  const output =
    selectedLive && (!persistedTerminal || !activeMessage)
      ? selectedLive.content
      : (activeMessage?.content ?? null)
  return {
    attempts,
    selectedId,
    generation,
    metrics,
    output,
    archived:
      attempts.find((attempt) => attempt.id === selectedId)?.archived ?? false,
    status: persistedTerminal
      ? generation.status
      : (selectedLive?.status ?? generation?.status ?? null),
  }
}

const metricNumber = new Intl.NumberFormat("ja-JP", {
  maximumFractionDigits: 2,
})

export function formatMetric(value: number | null | undefined, unit = "") {
  return value == null
    ? "未取得"
    : `${metricNumber.format(value)}${unit ? ` ${unit}` : ""}`
}
