import { create } from "zustand"

const settingsTabs = ["provider", "defaults", "general"] as const
export type SettingsTab = (typeof settingsTabs)[number]
export const isSettingsTab = (value: string): value is SettingsTab =>
  (settingsTabs as readonly string[]).includes(value)

/** The settings dialog, so any view can open it at a given tab. */
export const useSettingsDialog = create<{ open: boolean; tab: SettingsTab }>(
  () => ({ open: false, tab: "provider" })
)

export const openSettings = (tab: SettingsTab = "provider") =>
  useSettingsDialog.setState({ open: true, tab })
