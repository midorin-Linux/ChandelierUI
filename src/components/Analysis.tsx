import { useState } from "react"
import type { ReactNode } from "react"
import { Button } from "@/src/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/src/components/ui/sheet"
import {
  contextUtilization,
  formatMetric,
  isFailed,
  providerLocation,
  summarizeAttempts,
} from "@/src/lib/analysis"
import type { CompletionAttempt } from "@/src/types/analysis"
import type { ProviderChatRequest } from "@/src/types/chat"

function MetricSection({
  title,
  rows,
}: {
  title: string
  rows: readonly (readonly [string, string])[]
}) {
  return (
    <section className="space-y-2">
      <h3 className="font-medium">{title}</h3>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="break-words text-sm tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function Kpi({ label, value }: { label: string; value: string }) {
  const unavailable = value === "Unavailable"
  return (
    <div className="min-w-0 rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`truncate text-2xl font-semibold tabular-nums ${unavailable ? "text-muted-foreground" : ""}`}
      >
        {unavailable ? "—" : value}
      </div>
    </div>
  )
}

function Note({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>
}

export function Analysis({
  payload,
  attempts,
  isPending,
}: {
  payload: ProviderChatRequest
  attempts: readonly CompletionAttempt[]
  isPending: boolean
}) {
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const latest = attempts[attempts.length - 1]
  const selected =
    selectedId === null
      ? latest
      : (attempts.find((attempt) => attempt.id === selectedId) ?? latest)
  const summary = summarizeAttempts(attempts)
  const metrics = selected?.result.metrics
  const location = selected
    ? providerLocation(selected.payload.provider.base_url)
    : null
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">Analysis</Button>
      </SheetTrigger>
      <SheetContent
        showCloseButton={false}
        className="min-h-0 data-[side=right]:w-full! data-[side=right]:sm:max-w-3xl!"
      >
        <SheetHeader className="shrink-0">
          <SheetTitle>Analysis</SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 pb-6">
          {isPending && (
            <p role="status" className="rounded-lg border p-3 text-sm">
              Request in progress. Measurements below describe completed
              attempts only, not the pending request.
            </p>
          )}
          {!selected || !metrics || !location ? (
            <p className="text-sm text-muted-foreground">No measurements yet</p>
          ) : (
            <>
              <div className="space-y-2">
                <label
                  htmlFor="analysis-attempt"
                  className="block text-sm font-medium"
                >
                  Attempt history
                </label>
                <select
                  id="analysis-attempt"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={selectedId === null ? "latest" : String(selected.id)}
                  onChange={(event) =>
                    setSelectedId(
                      event.target.value === "latest"
                        ? null
                        : Number(event.target.value)
                    )
                  }
                >
                  <option value="latest">
                    Latest completed attempt (#{latest.id})
                  </option>
                  {attempts.map((attempt) => (
                    <option key={attempt.id} value={attempt.id}>
                      #{attempt.id} · {attempt.started_at} ·{" "}
                      {isFailed(attempt) ? "Failed" : "Succeeded"}
                    </option>
                  ))}
                </select>
                <Note>
                  Showing the saved snapshot for attempt #{selected.id}. Editing
                  the current request does not change these measurements.
                </Note>
              </div>
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Kpi
                    label="TTFT"
                    value={formatMetric(metrics.ttft_ms, "ms")}
                  />
                  <Kpi
                    label="End to end"
                    value={formatMetric(metrics.e2e_ms, "ms")}
                  />
                  <Kpi
                    label="Output TPS"
                    value={formatMetric(metrics.output_tps, "tokens/s")}
                  />
                  <Kpi
                    label="Total tokens"
                    value={formatMetric(metrics.total_tokens, "tokens", 0)}
                  />
                </div>
                {isFailed(selected) && (
                  <p
                    role="status"
                    className="rounded-md border border-destructive/50 px-3 py-2 text-sm text-destructive"
                  >
                    Failed{metrics.timed_out ? " · Timed out" : ""}
                    {selected.result.error ? ` · ${selected.result.error}` : ""}
                  </p>
                )}
              </div>
              <MetricSection
                title="Request snapshot"
                rows={[
                  ["Model", selected.payload.request.model],
                  ["Provider", location.provider],
                  ["Base URL", selected.payload.provider.base_url],
                  ["Location", location.classification],
                  ["Endpoint path", location.endpoint],
                  ["Started at", selected.started_at],
                  ["Temperature", "Provider default (not sent)"],
                  ["max_tokens", "Provider default (not sent)"],
                  ["Streaming transport", "true (SSE; usage requested)"],
                  [
                    "Reasoning effort",
                    selected.payload.request.reasoning_effort,
                  ],
                  [
                    "Input tokens (API usage)",
                    formatMetric(metrics.input_tokens, "tokens", 0),
                  ],
                  [
                    "Concurrency at start",
                    formatMetric(selected.concurrency, "", 0),
                  ],
                ]}
              />
              <MetricSection
                title="Latency"
                rows={[
                  [
                    "Time to first visible content (TTFT)",
                    formatMetric(metrics.ttft_ms, "ms"),
                  ],
                  [
                    "Time to first body bytes (TTFB)",
                    formatMetric(metrics.ttfb_ms, "ms"),
                  ],
                  ["End to end", formatMetric(metrics.e2e_ms, "ms")],
                  [
                    "Observed decode window",
                    formatMetric(metrics.decode_ms, "ms"),
                  ],
                  ["Server prefill", formatMetric(metrics.prefill_ms, "ms")],
                  [
                    "Server decode",
                    formatMetric(metrics.server_decode_ms, "ms"),
                  ],
                  ["Connection", formatMetric(metrics.connection_ms, "ms")],
                  ["DNS", formatMetric(metrics.dns_ms, "ms")],
                  ["TCP", formatMetric(metrics.tcp_ms, "ms")],
                  ["TLS", formatMetric(metrics.tls_ms, "ms")],
                ]}
              />
              <Note>
                Timings are backend monotonic measurements. Connection phases
                and server prefill/decode are unavailable when not exposed; TTFT
                is not a prefill measurement. Streaming is the transport; the
                chat reply is displayed after completion.
              </Note>
              <MetricSection
                title="Throughput and token timing"
                rows={[
                  [
                    "Output throughput",
                    formatMetric(metrics.output_tps, "tokens/s"),
                  ],
                  [
                    "Derived time per output token (TPOT)",
                    formatMetric(metrics.tpot_ms, "ms/token"),
                  ],
                  [
                    "True inter-token latency: mean",
                    formatMetric(metrics.itl_mean_ms, "ms"),
                  ],
                  [
                    "True inter-token latency: maximum",
                    formatMetric(metrics.itl_max_ms, "ms"),
                  ],
                  [
                    "True inter-token latency: standard deviation",
                    formatMetric(metrics.itl_stddev_ms, "ms"),
                  ],
                ]}
              />
              <Note>
                TPS uses API-reported output tokens (possibly including
                reasoning) over the observed window after first visible content.
                TPOT divides that window by output tokens minus one. Neither is
                an estimate from visible-text tokenization. SSE chunks may
                contain multiple tokens, so they do not establish true per-token
                events or ITL.
              </Note>
              <MetricSection
                title="Received content-chunk intervals (not token latency)"
                rows={[
                  [
                    "Mean interval",
                    formatMetric(metrics.chunk_interval_mean_ms, "ms"),
                  ],
                  [
                    "Maximum interval",
                    formatMetric(metrics.chunk_interval_max_ms, "ms"),
                  ],
                  [
                    "Interval standard deviation",
                    formatMetric(metrics.chunk_interval_stddev_ms, "ms"),
                  ],
                ]}
              />
              <MetricSection
                title="Usage and context"
                rows={[
                  [
                    "Input tokens",
                    formatMetric(metrics.input_tokens, "tokens", 0),
                  ],
                  [
                    "Output tokens",
                    formatMetric(metrics.output_tokens, "tokens", 0),
                  ],
                  [
                    "Total tokens",
                    formatMetric(metrics.total_tokens, "tokens", 0),
                  ],
                  [
                    "Cached input tokens",
                    formatMetric(metrics.cached_tokens, "tokens", 0),
                  ],
                  [
                    "Reasoning tokens",
                    formatMetric(metrics.reasoning_tokens, "tokens", 0),
                  ],
                  [
                    "Known model context maximum",
                    formatMetric(selected.context_length, "tokens", 0),
                  ],
                  [
                    "Context utilization (input / known maximum)",
                    formatMetric(
                      contextUtilization(
                        metrics.input_tokens,
                        selected.context_length
                      ),
                      "%"
                    ),
                  ],
                ]}
              />
              <Note>
                Usage is API-reported, not locally estimated. Missing values are
                unavailable, not zero. Context utilization requires a known
                model maximum.
              </Note>
              <MetricSection
                title="Attempt result"
                rows={[
                  ["HTTP status", formatMetric(metrics.http_status, "", 0)],
                  ["Finish reason", metrics.finish_reason ?? "Unavailable"],
                  ["Error", selected.result.error ?? "None"],
                  ["Timed out", metrics.timed_out ? "Yes" : "No"],
                  ["Retry attempt", selected.retry ? "Yes" : "No"],
                ]}
              />
            </>
          )}
          <MetricSection
            title="Reliability — all completed attempts this session"
            rows={[
              ["Attempt count", formatMetric(summary.count, "", 0)],
              ["Errors", formatMetric(summary.errors, "", 0)],
              ["Error rate", formatMetric(summary.errorRate, "%")],
              ["Timeouts", formatMetric(summary.timeouts, "", 0)],
              ["Timeout rate", formatMetric(summary.timeoutRate, "%")],
              ["Retry count", formatMetric(summary.retries, "", 0)],
              ["HTTP 429 count", formatMetric(summary.rateLimited, "", 0)],
              ["HTTP 5xx count", formatMetric(summary.serverErrors, "", 0)],
            ]}
          />
          <Note>
            Rates use all completed attempts, including failures. Retry counts
            reflect explicit retry attempts; no automatic retries or fallback
            are performed.
          </Note>
          <details className="border-t py-2">
            <summary className="cursor-pointer text-sm">
              Request JSON (current editor preview only — not the saved attempt)
            </summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-muted p-3 text-xs">
              {JSON.stringify(payload, null, 2)}
            </pre>
          </details>
        </div>
      </SheetContent>
    </Sheet>
  )
}
