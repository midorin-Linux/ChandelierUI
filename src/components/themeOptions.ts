import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react"

export type Theme = "system" | "light" | "dark"

/** One list for the settings page and the app menu, so both read the same. */
export const themeOptions = [
  { value: "system", label: "System", icon: MonitorIcon },
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
] as const satisfies readonly { value: Theme; label: string; icon: unknown }[]

export const isTheme = (value: unknown): value is Theme =>
  themeOptions.some((option) => option.value === value)
