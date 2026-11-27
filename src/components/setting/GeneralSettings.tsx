import { useCallback, useState } from "react"
import { Tabs, TabsList, TabsTrigger } from "@/src/components/ui/tabs"
import { useTheme } from "@/src/components/ThemeProvider"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/src/components/ui/combobox"
import { Textarea } from "@/src/components/ui/textarea"
import { efforts } from "@/src/types/chat"
import { presetLabel } from "@/src/stores/chat"
import { useModelsStore } from "@/src/stores/models"
import { providerModelsView } from "@/src/lib/models"
import { ModelBrowser } from "@/src/components/ModelBrowser"
import { Button } from "@/src/components/ui/button"
import {
  isTimeoutSecs,
  MAX_TIMEOUT_SECS,
  setDefaults,
  setTimeoutSecs,
  useSettingsStore,
} from "@/src/stores/settings"
import { Input } from "@/src/components/ui/input"
import { Separator } from "@/src/components/ui/separator"

export function GeneralSettings() {
  const defaults = useSettingsStore((s) => s.defaults)
  const timeoutSecs = useSettingsStore((s) => s.timeoutSecs)
  const { theme, setTheme } = useTheme()
  // A body-level portal counts as outside the Radix dialog, so clicks never select.
  const [dialog, setDialog] = useState<HTMLElement | null>(null)
  const dialogRef = useCallback(
    (node: HTMLElement | null) =>
      setDialog(
        node?.closest<HTMLElement>("[data-slot=dialog-content]") ?? null
      ),
    []
  )

  return (
    <div ref={dialogRef} className="flex flex-col gap-8">
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

      {/*Response*/}
      <div className="flex flex-col gap-3">
        <h3 className="text-base font-semibold">Response</h3>
        <div className="flex items-center justify-between gap-4">
          <div>
            <label htmlFor="response-timeout" className="text-sm">
              Timeout (seconds)
            </label>
            <p className="text-sm text-muted-foreground">
              Longest wait without receiving data from the provider (1–
              {MAX_TIMEOUT_SECS}). The timer restarts whenever data arrives.
            </p>
          </div>
          {/* Uncontrolled, so the field can be empty while typing. */}
          <Input
            id="response-timeout"
            type="number"
            min={1}
            max={MAX_TIMEOUT_SECS}
            className="w-24"
            defaultValue={timeoutSecs}
            onChange={(e) => {
              const value = e.target.valueAsNumber
              if (isTimeoutSecs(value)) setTimeoutSecs(value)
            }}
            // Invalid input is never saved, so show the saved value again.
            onBlur={(e) => {
              e.target.value = String(useSettingsStore.getState().timeoutSecs)
            }}
          />
        </div>
      </div>

      {/*New chat*/}
      <div className="flex flex-col gap-3">
        <div>
          <h3 className="text-base font-semibold">New chat</h3>
          <p className="text-sm text-muted-foreground">
            What a new chat starts with. Changing these never affects existing
            chats.
          </p>
        </div>
        <DefaultModel />
        <Separator />
        <div className="flex items-center justify-between gap-4">
          <div>
            <div id="default-effort-label" className="text-sm">
              Effort
            </div>
            <p className="text-sm text-muted-foreground">
              Reasoning effort for new chats.
            </p>
          </div>
          <Combobox
            items={efforts}
            value={defaults.effort}
            onValueChange={(value) => value && setDefaults({ effort: value })}
          >
            <ComboboxInput
              aria-labelledby="default-effort-label"
              placeholder={"Select an effort..."}
            />
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
        <div className="flex flex-col gap-2">
          <label htmlFor="default-system-prompt" className="text-sm">
            System prompt
          </label>
          <Textarea
            id="default-system-prompt"
            placeholder="You are a helpful assistant."
            value={defaults.systemPrompt}
            onChange={(e) => setDefaults({ systemPrompt: e.target.value })}
          />
        </div>
      </div>
    </div>
  )
}

/** The default model is a provider and one of its models, picked together. */
function DefaultModel() {
  const defaults = useSettingsStore((s) => s.defaults)
  const presets = useSettingsStore((s) => s.presets)
  const lists = useModelsStore()
  const [picking, setPicking] = useState(false)
  const preset = defaults.model
    ? presets.find((p) => p.id === defaults.providerId)
    : undefined
  const view = preset ? providerModelsView(lists, preset) : null
  // Kept while the list is loading or lacks it; the provider may list it again.
  const missing =
    view !== null &&
    !view.loading &&
    !view.models.some((model) => model.id === defaults.model)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div id="default-model-label" className="text-sm">
            Model
          </div>
          <p className="text-sm text-muted-foreground">
            When unset, a new chat keeps the current chat&apos;s model.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {defaults.model && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDefaults({ model: "" })}
            >
              Unset
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            aria-expanded={picking}
            onClick={() => setPicking(!picking)}
          >
            {picking ? "Done" : "Change"}
          </Button>
        </div>
      </div>
      <div
        aria-labelledby="default-model-label"
        className="flex min-w-0 flex-col rounded-md border px-3 py-2 text-sm"
      >
        {defaults.model ? (
          <>
            <span className="truncate">{defaults.model}</span>
            <span className="text-xs text-muted-foreground">
              {preset ? presetLabel(preset) : "Unknown provider"}
              {missing && " · not in this provider's current model list"}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">
            Keep the current chat&apos;s model
          </span>
        )}
      </div>
      {picking && (
        <ModelBrowser
          className="max-h-80 rounded-md border p-2"
          presets={presets}
          selected={
            defaults.model
              ? { providerId: defaults.providerId, model: defaults.model }
              : null
          }
          onSelect={(providerId, model) => {
            setDefaults({ providerId, model })
            setPicking(false)
          }}
          focusSearch
        />
      )}
    </div>
  )
}
