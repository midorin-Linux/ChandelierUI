import { useState } from "react"
import { ChevronsUpDownIcon, RotateCcwIcon } from "lucide-react"
import { EffortPicker } from "@/src/components/EffortPicker"
import { ModelBrowser } from "@/src/components/ModelBrowser"
import { useTheme } from "@/src/components/ThemeProvider"
import {
  baseColorOptions,
  isBaseColor,
  isTheme,
  themeOptions,
} from "@/src/components/themeOptions"
import { Button } from "@/src/components/ui/button"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldSeparator,
  FieldTitle,
} from "@/src/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/src/components/ui/input-group"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/src/components/ui/popover"
import { Tabs, TabsList, TabsTrigger } from "@/src/components/ui/tabs"
import { Textarea } from "@/src/components/ui/textarea"
import { providerModelsView } from "@/src/lib/models"
import { presetLabel } from "@/src/stores/chat"
import { useModelsStore } from "@/src/stores/models"
import {
  DEFAULT_TIMEOUT_SECS,
  isTimeoutSecs,
  MAX_TIMEOUT_SECS,
  setDefaults,
  setTimeoutSecs,
  useSettingsStore,
} from "@/src/stores/settings"
import type { ReactNode } from "react"

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h3 className="text-base font-semibold">{title}</h3>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </section>
  )
}

export function GeneralSettings() {
  const { theme, setTheme, baseColor, setBaseColor } = useTheme()

  return (
    <div className="flex flex-col gap-8">
      <Section title="Appearance">
        <Field orientation="horizontal">
          <FieldContent>
            <FieldTitle id="theme-label">Theme</FieldTitle>
            <FieldDescription>
              Choose light, dark, or follow your system setting.
            </FieldDescription>
          </FieldContent>
          <Tabs
            value={theme}
            onValueChange={(value) => isTheme(value) && setTheme(value)}
          >
            <TabsList aria-labelledby="theme-label">
              {themeOptions.map(({ value, label, icon: Icon }) => (
                <TabsTrigger key={value} value={value}>
                  <Icon />
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldTitle id="base-color-label">Base color</FieldTitle>
            <FieldDescription>
              The tint of backgrounds, borders, and text.
            </FieldDescription>
          </FieldContent>
          <Tabs
            value={baseColor}
            onValueChange={(value) => isBaseColor(value) && setBaseColor(value)}
          >
            <TabsList aria-labelledby="base-color-label">
              {baseColorOptions.map(({ value, label }) => (
                <TabsTrigger key={value} value={value}>
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </Field>
      </Section>

      <Section title="Advanced">
        <TimeoutField />
      </Section>
    </div>
  )
}

/** What a new chat starts with. */
export function ChatDefaults() {
  const defaults = useSettingsStore((s) => s.defaults)

  return (
    <div className="flex flex-col gap-8">
      <Section
        title="New chat"
        description="What a new chat starts with. Changing these never affects existing chats, and each chat can change them from the model button."
      >
        <DefaultModel />
        <FieldSeparator />
        <Field>
          <FieldTitle id="default-effort-label">Effort</FieldTitle>
          <EffortPicker
            value={defaults.effort}
            onChange={(effort) => setDefaults({ effort })}
            labelledBy="default-effort-label"
            hintId="default-effort-hint"
          />
        </Field>
        <FieldSeparator />
        <Field>
          <FieldLabel htmlFor="default-system-prompt">System prompt</FieldLabel>
          <Textarea
            id="default-system-prompt"
            placeholder="You are a helpful assistant."
            value={defaults.systemPrompt}
            onChange={(e) => setDefaults({ systemPrompt: e.target.value })}
          />
        </Field>
      </Section>
    </div>
  )
}

/** Saved only when valid; an invalid entry is explained, and dropped on blur. */
function TimeoutField() {
  const timeoutSecs = useSettingsStore((s) => s.timeoutSecs)
  // Text, so the field can be empty while typing.
  const [draft, setDraft] = useState(String(timeoutSecs))
  const value = Number(draft)
  const invalid = !isTimeoutSecs(value)

  return (
    <Field orientation="horizontal" data-invalid={invalid || undefined}>
      <FieldContent>
        <FieldLabel htmlFor="response-timeout">Timeout</FieldLabel>
        <FieldDescription id="response-timeout-hint">
          Longest wait without receiving data from the provider. The timer
          restarts whenever data arrives.
        </FieldDescription>
        {invalid && (
          <FieldError id="response-timeout-error">
            Enter a whole number from 1 to {MAX_TIMEOUT_SECS}.
          </FieldError>
        )}
      </FieldContent>
      <div className="flex shrink-0 items-center gap-1">
        {timeoutSecs !== DEFAULT_TIMEOUT_SECS && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Reset to ${DEFAULT_TIMEOUT_SECS} seconds`}
            title={`Reset to ${DEFAULT_TIMEOUT_SECS} seconds`}
            onClick={() => {
              setTimeoutSecs(DEFAULT_TIMEOUT_SECS)
              setDraft(String(DEFAULT_TIMEOUT_SECS))
            }}
          >
            <RotateCcwIcon />
          </Button>
        )}
        <InputGroup className="w-32">
          <InputGroupInput
            id="response-timeout"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_TIMEOUT_SECS}
            aria-invalid={invalid || undefined}
            aria-describedby={
              invalid
                ? "response-timeout-hint response-timeout-error"
                : "response-timeout-hint"
            }
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              const next = Number(e.target.value)
              if (e.target.value.trim() && isTimeoutSecs(next))
                setTimeoutSecs(next)
            }}
            onBlur={() =>
              setDraft(String(useSettingsStore.getState().timeoutSecs))
            }
          />
          <InputGroupAddon align="inline-end">
            <InputGroupText>sec</InputGroupText>
          </InputGroupAddon>
        </InputGroup>
      </div>
    </Field>
  )
}

/** The default model is a provider and one of its models, picked together. */
function DefaultModel() {
  const defaults = useSettingsStore((s) => s.defaults)
  const presets = useSettingsStore((s) => s.presets)
  const lists = useModelsStore()
  const [open, setOpen] = useState(false)
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
    <Field orientation="horizontal">
      <FieldContent>
        <FieldTitle id="default-model-label">Model</FieldTitle>
        <FieldDescription>
          {missing
            ? "Not in this provider's current model list."
            : "When unset, a new chat keeps the current chat's model."}
        </FieldDescription>
      </FieldContent>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            aria-labelledby="default-model-label default-model-value"
            className="h-auto max-w-72 min-w-48 justify-between py-1.5 text-left"
          >
            <span id="default-model-value" className="flex min-w-0 flex-col">
              <span className="truncate">
                {defaults.model || "Current chat's model"}
              </span>
              {defaults.model && (
                <span className="truncate text-xs font-normal text-muted-foreground">
                  {preset ? presetLabel(preset) : "Unknown provider"}
                </span>
              )}
            </span>
            <ChevronsUpDownIcon className="text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="flex w-96 flex-col gap-1 p-2">
          <Button
            variant={defaults.model ? "ghost" : "secondary"}
            size="sm"
            className="justify-start"
            onClick={() => {
              setDefaults({ model: "" })
              setOpen(false)
            }}
          >
            Keep the current chat&apos;s model
          </Button>
          <ModelBrowser
            className="max-h-80"
            presets={presets}
            selected={
              defaults.model
                ? { providerId: defaults.providerId, model: defaults.model }
                : null
            }
            onSelect={(providerId, model) => {
              setDefaults({ providerId, model })
              setOpen(false)
            }}
            focusSearch
          />
        </PopoverContent>
      </Popover>
    </Field>
  )
}
