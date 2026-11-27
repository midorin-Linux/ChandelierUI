import { useState } from "react"
import { RotateCcwIcon } from "lucide-react"
import { EffortPicker } from "@/src/components/EffortPicker"
import { ModelBrowser } from "@/src/components/ModelBrowser"
import { useTheme } from "@/src/components/ThemeProvider"
import { isTheme, themeOptions } from "@/src/components/themeOptions"
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
  const defaults = useSettingsStore((s) => s.defaults)
  const { theme, setTheme } = useTheme()

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
      </Section>

      <Section title="Response">
        <TimeoutField />
      </Section>

      <Section
        title="New chat"
        description="What a new chat starts with. Changing these never affects existing chats."
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
