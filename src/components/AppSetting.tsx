import { ServerIcon, SettingsIcon } from "lucide-react"
import type { ComponentType } from "react"
import { DialogContent, DialogTitle } from "@/src/components/ui/dialog"
import { Button } from "@/src/components/ui/button"
import { GeneralSettings } from "@/src/components/setting/GeneralSettings"
import { ProviderSettings } from "@/src/components/setting/ProviderSettings"
import { SaveStatus } from "@/src/components/setting/SaveStatus"

import type { SettingsTab } from "@/src/stores/settingsDialog"

const tabs: { id: SettingsTab; label: string; icon: ComponentType }[] = [
  { id: "general", label: "General", icon: SettingsIcon },
  { id: "provider", label: "Providers", icon: ServerIcon },
]

export function AppSetting({
  tab,
  onTabChange,
}: {
  tab: SettingsTab
  onTabChange: (tab: SettingsTab) => void
}) {
  const current = tabs.find(({ id }) => id === tab)!

  return (
    <DialogContent className="flex h-[min(52rem,calc(100dvh-2rem))] w-[min(76rem,calc(100%-2rem))] flex-col overflow-hidden sm:max-w-none">
      <header className="flex items-center justify-between gap-4 border-b px-4 py-4 pr-14">
        <DialogTitle className="text-lg font-semibold">Settings</DialogTitle>
        <SaveStatus />
      </header>
      {/* Side navigation on wide windows, a row of tabs above the content on narrow ones. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        <nav
          aria-label="Settings sections"
          className="flex shrink-0 gap-1 overflow-x-auto border-b pb-2 md:w-48 md:flex-col md:overflow-y-auto md:border-r md:border-b-0 md:py-2 md:pr-4"
        >
          {tabs.map(({ id, label, icon: Icon }) => (
            <Button
              key={id}
              variant={tab === id ? "secondary" : "ghost"}
              className="justify-start md:w-full"
              aria-current={tab === id ? "page" : undefined}
              onClick={() => onTabChange(id)}
            >
              <Icon />
              {label}
            </Button>
          ))}
        </nav>
        <section className="min-h-0 min-w-0 flex-1 overflow-y-auto py-4 md:p-4 md:pl-6">
          <h2 className="mb-4 text-lg font-semibold">{current.label}</h2>
          {tab === "general" && <GeneralSettings />}
          {tab === "provider" && <ProviderSettings />}
        </section>
      </div>
    </DialogContent>
  )
}
