import { create } from "zustand"

export type SettingsTab = "general" | "provider"

/** The settings dialog, so any view can open it at a given tab. */
export const useSettingsDialog = create<{ open: boolean; tab: SettingsTab }>(
  () => ({ open: false, tab: "general" })
)

export const openSettings = (tab: SettingsTab = "general") =>
  useSettingsDialog.setState({ open: true, tab })
