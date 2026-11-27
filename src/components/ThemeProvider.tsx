import { createContext, useContext, useEffect, useState } from "react"
import {
  isBaseColor,
  isTheme,
  type BaseColor,
  type Theme,
} from "@/src/components/themeOptions"

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
}

type ThemeProviderState = {
  theme: Theme
  setTheme: (theme: Theme) => void
  baseColor: BaseColor
  setBaseColor: (baseColor: BaseColor) => void
}

const initialState: ThemeProviderState = {
  theme: "system",
  setTheme: () => null,
  baseColor: "simple",
  setBaseColor: () => null,
}

const BASE_COLOR_KEY = "ui-base-color"

function readStored<T>(
  key: string,
  isValid: (v: unknown) => v is T,
  fallback: T
) {
  // An unknown stored value (or a blocked storage) falls back to the default.
  try {
    const saved = localStorage.getItem(key)
    return isValid(saved) ? saved : fallback
  } catch {
    return fallback
  }
}

const ThemeProviderContext = createContext<ThemeProviderState>(initialState)

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "vite-ui-theme",
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(() =>
    readStored(storageKey, isTheme, defaultTheme)
  )
  const [baseColor, setBaseColor] = useState<BaseColor>(() =>
    readStored(BASE_COLOR_KEY, isBaseColor, "simple")
  )

  useEffect(() => {
    document.documentElement.dataset.baseColor = baseColor
  }, [baseColor])

  useEffect(() => {
    const root = window.document.documentElement

    root.classList.remove("light", "dark")

    if (theme === "system") {
      const media = window.matchMedia("(prefers-color-scheme: dark)")
      const applySystemTheme = () => {
        root.classList.toggle("dark", media.matches)
        root.classList.toggle("light", !media.matches)
      }
      applySystemTheme()
      media.addEventListener("change", applySystemTheme)
      return () => media.removeEventListener("change", applySystemTheme)
    }

    root.classList.add(theme)
  }, [theme])

  const value = {
    theme,
    setTheme: (theme: Theme) => {
      localStorage.setItem(storageKey, theme)
      setTheme(theme)
    },
    baseColor,
    setBaseColor: (baseColor: BaseColor) => {
      localStorage.setItem(BASE_COLOR_KEY, baseColor)
      setBaseColor(baseColor)
    },
  }

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext)

  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider")

  return context
}
