import { useEffect, useState, type ReactNode } from "react"
import { desktop } from "@/src/lib/api"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { cn } from "@/src/lib/utils"
import { useSession } from "@/src/stores/chat"

// Segoe Fluent Icons caption glyphs, as used by the native Windows 11 title bar.
const GLYPH = {
  minimize: "",
  maximize: "",
  restore: "",
  close: "",
}

function CaptionButton({
  label,
  glyph,
  onClick,
  close,
}: {
  label: string
  glyph: string
  onClick: () => void
  close?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      tabIndex={-1}
      onClick={onClick}
      className={cn(
        "inline-flex h-full w-[46px] items-center justify-center bg-transparent font-[Segoe_Fluent_Icons,Segoe_MDL2_Assets] text-[10px] text-foreground",
        close
          ? "hover:bg-[#c42b1c] hover:text-white active:bg-[#c42b1c]/90"
          : "hover:bg-foreground/10 active:bg-foreground/5"
      )}
    >
      {glyph}
    </button>
  )
}

// Height matches the sidebar header (`h-10` in AppSidebar.tsx).
export function TitleBar({ children }: { children?: ReactNode }) {
  const [maximized, setMaximized] = useState(false)
  const title = useSession((s) =>
    s.activeId === null
      ? "New chat"
      : s.sessions.find((session) => session.id === s.activeId)?.title ||
        "Untitled"
  )

  useEffect(() => {
    if (!desktop) return
    const win = getCurrentWindow()
    const sync = () => void win.isMaximized().then(setMaximized)
    sync()
    const unlisten = win.onResized(sync)
    return () => void unlisten.then((stop) => stop())
  }, [])

  return (
    <header
      data-tauri-drag-region
      className="flex h-10 shrink-0 items-center justify-between gap-4 border-b bg-background select-none"
    >
      {/* Drag regions only apply to the element itself, so the title gets one too. */}
      <h1
        data-tauri-drag-region
        className="min-w-0 truncate pl-4 text-sm font-medium"
      >
        {title}
      </h1>
      <div className="flex h-full items-center">
        <div className="mr-2 flex items-center">{children}</div>
        {desktop && (
          <>
            <CaptionButton
              label="Minimize"
              glyph={GLYPH.minimize}
              onClick={() => void getCurrentWindow().minimize()}
            />
            <CaptionButton
              label={maximized ? "Restore" : "Maximize"}
              glyph={maximized ? GLYPH.restore : GLYPH.maximize}
              onClick={() => void getCurrentWindow().toggleMaximize()}
            />
            <CaptionButton
              close
              label="Close"
              glyph={GLYPH.close}
              onClick={() => void getCurrentWindow().close()}
            />
          </>
        )}
      </div>
    </header>
  )
}
