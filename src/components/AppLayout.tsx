import type { ReactNode } from "react"

interface AppLayoutProps {
  sidebar: ReactNode
  children: ReactNode
}

export function AppLayout({ sidebar, children }: AppLayoutProps) {
  return (
    <div className="workspace">
      {sidebar}
      <main id="main-content" className="workspace-main" tabIndex={-1}>
        {children}
      </main>
    </div>
  )
}
