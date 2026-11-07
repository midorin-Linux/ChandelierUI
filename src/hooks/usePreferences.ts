import { useEffect } from "react"
import type { AppPreferences } from "../types/domain"

export function usePreferences(settings: AppPreferences | undefined) {
  const theme = settings?.theme ?? "system"
  const width = settings?.chat_width ?? 880
  const fontSize = settings?.font_size ?? 15
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const applyTheme = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches)
      document.documentElement.classList.toggle("dark", dark)
      document.documentElement.style.colorScheme = dark ? "dark" : "light"
    }
    applyTheme()
    if (theme === "system") media.addEventListener("change", applyTheme)
    return () => media.removeEventListener("change", applyTheme)
  }, [theme])
  useEffect(() => {
    document.documentElement.style.setProperty("--chat-width", `${width}px`)
    document.documentElement.style.setProperty(
      "--chat-font-size",
      `${fontSize}px`
    )
  }, [width, fontSize])
}
