export function Badge({ children }: { children: string }) {
  return (
    <span className="rounded-sm bg-muted px-1 py-px text-[0.65rem] leading-tight font-medium text-muted-foreground uppercase">
      {children}
    </span>
  )
}
