import { useState } from "react"
import { Tabs, TabsList, TabsTrigger } from "@/src/components/ui/tabs"
import { useTheme } from "@/src/components/ThemeProvider"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/src/components/ui/combobox.tsx"
import { Textarea } from "@/src/components/ui/textarea.tsx"
import {
  efforts,
  type ApiModel,
  type SessionDefaults,
} from "@/src/types/chat.ts"
import { Separator } from "@/src/components/ui/separator.tsx"

export function GeneralSettings({
  models,
  defaults,
  onDefaultsChange,
}: {
  models: ApiModel[]
  defaults: SessionDefaults
  onDefaultsChange: (defaults: SessionDefaults) => void
}) {
  const { theme, setTheme } = useTheme()
  // A body-level portal counts as outside the Radix dialog, so clicks never select.
  const [dialog, setDialog] = useState<HTMLElement | null>(null)

  return (
    <div
      ref={(node) =>
        setDialog(
          node?.closest<HTMLElement>("[data-slot=dialog-content]") ?? null
        )
      }
      className="flex flex-col gap-8"
    >
      {/*Appearance*/}
      <div className="flex flex-col gap-3">
        <h3 className="text-base font-semibold">Appearance</h3>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm">Theme</div>
            <p className="text-sm text-muted-foreground">
              Choose light, dark, or follow your system setting.
            </p>
          </div>
          <Tabs
            value={theme}
            onValueChange={(value) =>
              setTheme(value as "system" | "light" | "dark")
            }
          >
            <TabsList>
              {(["system", "light", "dark"] as const).map((value) => (
                <TabsTrigger key={value} value={value} className="capitalize">
                  {value}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </div>

      {/*Session*/}
      <div className="flex flex-col gap-3">
        <h3 className="text-base font-semibold">Session</h3>
        <div className="flex flex-col gap-2">
          <div className="text-sm">Default system prompt</div>
          <Textarea
            placeholder="You are a helpful assistant."
            value={defaults.systemPrompt}
            onChange={(e) =>
              onDefaultsChange({ ...defaults, systemPrompt: e.target.value })
            }
          />
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm">Default effort</div>
            <p className="text-sm text-muted-foreground">
              Reasoning effort for new sessions.
            </p>
          </div>
          <Combobox
            items={efforts}
            value={defaults.effort}
            onValueChange={(value) =>
              value && onDefaultsChange({ ...defaults, effort: value })
            }
          >
            <ComboboxInput placeholder={"Select an effort..."} />
            <ComboboxContent container={dialog}>
              <ComboboxEmpty>No items found.</ComboboxEmpty>
              <ComboboxList>
                {(item) => (
                  <ComboboxItem key={item} value={item}>
                    {item}
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </div>
        <Separator />
        <div className="flex flex-col items-start justify-between gap-2">
          <div>
            <div className="text-sm">Default model</div>
            <p className="text-sm text-muted-foreground">
              Model ID for new sessions. Leave empty to keep the current model.
            </p>
          </div>
          <Combobox
            items={models.map((model) => model.id)}
            value={defaults.model || null}
            onValueChange={(value) =>
              onDefaultsChange({ ...defaults, model: value ?? "" })
            }
          >
            <ComboboxInput
              placeholder="Select a model..."
              showClear
              className="w-full"
            />
            <ComboboxContent container={dialog}>
              <ComboboxEmpty>No models found.</ComboboxEmpty>
              <ComboboxList>
                {(item) => (
                  <ComboboxItem key={item} value={item}>
                    {item}
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </div>
      </div>
    </div>
  )
}
