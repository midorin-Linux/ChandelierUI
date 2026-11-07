interface MetricCardProps {
  label: string
  value: string
  description?: string
}

export function MetricCard({ label, value, description }: MetricCardProps) {
  return (
    <div className="metric-card">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-semibold tabular-nums [overflow-wrap:anywhere]">
        {value}
      </dd>
      {description && (
        <dd className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {description}
        </dd>
      )}
    </div>
  )
}
