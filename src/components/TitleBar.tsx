import { useEffect, useState, type ReactNode } from "react"
import { isTauri } from "@tauri-apps/api/core"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { cn } from "@/src/lib/utils"

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
  const desktop = isTauri()
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!desktop) return
    const win = getCurrentWindow()
    const sync = () => void win.isMaximized().then(setMaximized)
    sync()
    const unlisten = win.onResized(sync)
    return () => void unlisten.then((stop) => stop())
  }, [desktop])

  return (
    <header
      data-tauri-drag-region
      className="flex h-10 shrink-0 items-center justify-end border-b bg-background select-none"
    >
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
