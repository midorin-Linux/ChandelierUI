import { create } from "zustand"

export type SettingsTab = "provider" | "defaults" | "general"

/** The settings dialog, so any view can open it at a given tab. */
export const useSettingsDialog = create<{ open: boolean; tab: SettingsTab }>(
  () => ({ open: false, tab: "provider" })
)

export const openSettings = (tab: SettingsTab = "provider") =>
  useSettingsDialog.setState({ open: true, tab })
