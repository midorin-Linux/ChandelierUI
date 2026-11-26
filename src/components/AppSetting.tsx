import { ServerIcon, SettingsIcon } from "lucide-react"
import type { ComponentType } from "react"
import { DialogContent, DialogTitle } from "@/src/components/ui/dialog"
import { Button } from "@/src/components/ui/button"
import type { ApiModel } from "@/src/types/chat"
import { GeneralSettings } from "@/src/components/setting/GeneralSettings"
import {
  ProviderSettings,
  type ProviderSettingsProps,
} from "@/src/components/setting/ProviderSettings"

export type SettingsTab = "general" | "provider"

const tabs: { id: SettingsTab; label: string; icon: ComponentType }[] = [
  { id: "general", label: "General", icon: SettingsIcon },
  { id: "provider", label: "Provider", icon: ServerIcon },
]

export function AppSetting({
  tab,
  onTabChange,
  models,
  provider,
}: {
  tab: SettingsTab
  onTabChange: (tab: SettingsTab) => void
  models: ApiModel[]
  provider: ProviderSettingsProps
}) {
  const current = tabs.find(({ id }) => id === tab)!

  return (
    <DialogContent className="flex aspect-16/10 w-[min(80rem,calc(100%-2rem),calc((100dvh-2rem)*16/10))] flex-col overflow-hidden sm:max-w-none">
      <header className="border-b px-4 py-4 pr-14">
        <DialogTitle className="text-lg font-semibold">Settings</DialogTitle>
      </header>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <nav
          aria-label="Settings sections"
          className="flex w-1/4 min-w-0 flex-col gap-1 overflow-y-auto border-r py-2 pr-4"
        >
          {tabs.map(({ id, label, icon: Icon }) => (
            <Button
              key={id}
              variant={tab === id ? "secondary" : "ghost"}
              className="w-full justify-start"
              aria-current={tab === id ? "page" : undefined}
              onClick={() => onTabChange(id)}
            >
              <Icon />
              {label}
            </Button>
          ))}
        </nav>
        <section className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 pl-6">
          <h2 className="mb-4 text-lg font-semibold">{current.label}</h2>
          {tab === "general" && <GeneralSettings models={models} />}
          {tab === "provider" && <ProviderSettings {...provider} />}
        </section>
      </div>
    </DialogContent>
  )
}
