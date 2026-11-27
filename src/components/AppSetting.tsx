import { MessageSquareIcon, ServerIcon, SettingsIcon } from "lucide-react"
import type { ComponentType } from "react"
import { DialogContent, DialogTitle } from "@/src/components/ui/dialog"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/src/components/ui/tabs"
import {
  ChatDefaults,
  GeneralSettings,
} from "@/src/components/setting/GeneralSettings"
import { ProviderSettings } from "@/src/components/setting/ProviderSettings"
import { SaveStatus } from "@/src/components/setting/SaveStatus"

import { isSettingsTab, type SettingsTab } from "@/src/stores/settingsDialog"

// In setup order: a provider first, then what new chats start with.
const tabs: {
  id: SettingsTab
  label: string
  icon: ComponentType
  content: ComponentType
}[] = [
  {
    id: "provider",
    label: "Providers",
    icon: ServerIcon,
    content: ProviderSettings,
  },
  {
    id: "defaults",
    label: "Chat defaults",
    icon: MessageSquareIcon,
    content: ChatDefaults,
  },
  {
    id: "general",
    label: "General",
    icon: SettingsIcon,
    content: GeneralSettings,
  },
]

export function AppSetting({
  tab,
  onTabChange,
}: {
  tab: SettingsTab
  onTabChange: (tab: SettingsTab) => void
}) {
  return (
    <DialogContent className="flex h-[min(48rem,calc(100dvh-2rem))] w-[min(60rem,calc(100%-2rem))] flex-col overflow-hidden sm:max-w-none">
      <header className="flex items-center justify-between gap-4 px-4 pt-4 pr-14">
        <DialogTitle className="text-lg font-semibold">Settings</DialogTitle>
        <SaveStatus />
      </header>
      <Tabs
        value={tab}
        onValueChange={(value) => isSettingsTab(value) && onTabChange(value)}
        className="min-h-0 flex-1 gap-0"
      >
        <TabsList variant="line" className="border-b px-3 w-full justify-start">
          {tabs.map(({ id, label, icon: Icon }) => (
            <TabsTrigger key={id} value={id} className="flex-none px-2">
              <Icon />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map(({ id, content: Content }) => (
          <TabsContent
            key={id}
            value={id}
            className="min-h-0 overflow-y-auto p-4"
          >
            <Content />
          </TabsContent>
        ))}
      </Tabs>
    </DialogContent>
  )
}
