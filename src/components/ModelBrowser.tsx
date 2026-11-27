import { useId, useState } from "react"
import {
  CheckIcon,
  ChevronRightIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  CircleAlertIcon,
  LoaderCircleIcon,
  RotateCwIcon,
  SearchIcon,
  XIcon,
} from "lucide-react"
import { Button } from "@/src/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/src/components/ui/collapsible"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/src/components/ui/input-group"
import { filterModels, providerModelsView, searchTerms } from "@/src/lib/models"
import { cn } from "@/src/lib/utils"
import { presetLabel, refreshAllModels, refreshModels } from "@/src/stores/chat"
import { useModelsStore } from "@/src/stores/models"
import type { ModelChoice } from "@/src/lib/sessionDefaults"
import type { ProviderPreset } from "@/src/types/chat"

/** Long lists show this many models until "Show all" is pressed. */
const PREVIEW_COUNT = 50

/**
 * Every given provider's models, one collapsible group each, with one search
 * over all of them. Only the selected model's group starts open, so a long
 * list from another provider stays out of the way until it is wanted.
 */
export function ModelBrowser({
  presets,
  selected = null,
  onSelect,
  groupTitle = presetLabel,
  focusSearch = false,
  className,
}: {
  presets: readonly ProviderPreset[]
  selected?: ModelChoice | null
  /** Without it the models are listed but not selectable. */
  onSelect?: (providerId: string, model: string) => void
  groupTitle?: (preset: ProviderPreset) => string
  /** Focuses the search box on mount, for dialogs opened to pick a model. */
  focusSearch?: boolean
  className?: string
}) {
  const lists = useModelsStore()
  const [query, setQuery] = useState("")
  // Groups the user opened or closed; the rest use `defaultOpen`.
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [showAll, setShowAll] = useState<Record<string, boolean>>({})
  const searchId = useId()
  const terms = searchTerms(query)
  const searching = terms.length > 0
  const several = presets.length > 1

  const groups = presets.map((preset) => {
    const view = providerModelsView(lists, preset)
    // The provider name only narrows when there is more than one to tell apart.
    const matches = filterModels(
      view.models,
      terms,
      several ? presetLabel(preset) : ""
    )
    return { preset, view, matches }
  })
  const visible = searching
    ? groups.filter((group) => group.matches.length > 0)
    : groups
  const defaultOpen = (id: string) => !several || selected?.providerId === id
  const isOpen = (id: string) => searching || (open[id] ?? defaultOpen(id))
  const allOpen = groups.every((group) => isOpen(group.preset.id))
  const total = groups.reduce((sum, g) => sum + g.view.models.length, 0)
  const matched = visible.reduce((sum, g) => sum + g.matches.length, 0)

  function selectFirstMatch() {
    const first = visible.find((group) => group.matches.length > 0)
    if (onSelect && first) onSelect(first.preset.id, first.matches[0].id)
  }

  return (
    <div className={cn("flex min-h-0 flex-col gap-2", className)}>
      <div className="flex items-center gap-1">
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            id={searchId}
            type="search"
            className="[&::-webkit-search-cancel-button]:hidden"
            aria-label="Search models"
            placeholder={
              several ? "Search models or providers" : "Search models"
            }
            autoComplete="off"
            spellCheck={false}
            // eslint-disable-next-line jsx-a11y/no-autofocus -- the dialog opens to pick a model
            autoFocus={focusSearch}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query) {
                // Clear first; a second Escape closes the dialog.
                event.preventDefault()
                event.stopPropagation()
                setQuery("")
              } else if (event.key === "Enter" && searching) {
                event.preventDefault()
                selectFirstMatch()
              }
            }}
          />
          {query && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                aria-label="Clear search"
                onClick={() => setQuery("")}
              >
                <XIcon />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
        {several && (
          <>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={allOpen ? "Collapse all" : "Expand all"}
              title={allOpen ? "Collapse all" : "Expand all"}
              disabled={searching}
              onClick={() =>
                setOpen(
                  Object.fromEntries(groups.map((g) => [g.preset.id, !allOpen]))
                )
              }
            >
              {allOpen ? <ChevronsDownUpIcon /> : <ChevronsUpDownIcon />}
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Refresh all providers"
              title="Refresh all providers"
              onClick={refreshAllModels}
            >
              <RotateCwIcon />
            </Button>
          </>
        )}
      </div>
      <p role="status" className="px-1 text-xs text-muted-foreground">
        {presets.length === 0
          ? "No providers yet."
          : searching
            ? `${matched} of ${total} models match`
            : several
              ? `${total} models from ${presets.length} providers`
              : null}
      </p>
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1">
        {searching && visible.length === 0 && (
          <p className="px-1 py-2 text-sm text-muted-foreground">
            No models match &quot;{query.trim()}&quot;.
          </p>
        )}
        {visible.map(({ preset, view, matches }) => {
          const expanded = showAll[preset.id] ?? false
          const shown = expanded ? matches : matches.slice(0, PREVIEW_COUNT)
          const hidden = matches.length - shown.length
          return (
            <Collapsible
              key={preset.id}
              open={isOpen(preset.id)}
              onOpenChange={(value) =>
                setOpen((prev) => ({ ...prev, [preset.id]: value }))
              }
              className="shrink-0"
            >
              <div className="flex items-center gap-1">
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="group/trigger min-w-0 flex-1 justify-start"
                  >
                    <ChevronRightIcon className="transition-transform group-data-[state=open]/trigger:rotate-90" />
                    <span className="truncate font-semibold">
                      {groupTitle(preset)}
                    </span>
                    <span className="ml-auto flex shrink-0 items-center gap-1 font-normal text-muted-foreground">
                      {view.loading ? (
                        <LoaderCircleIcon
                          className="animate-spin"
                          aria-label="Loading"
                        />
                      ) : view.error ? (
                        <CircleAlertIcon
                          className="text-destructive"
                          aria-label="Error"
                        />
                      ) : (
                        <span className="tabular-nums">
                          {searching
                            ? `${matches.length} / ${view.models.length}`
                            : view.models.length}
                        </span>
                      )}
                    </span>
                  </Button>
                </CollapsibleTrigger>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Refresh ${presetLabel(preset)}`}
                  title="Refresh"
                  disabled={view.loading || !preset.baseUrl.trim()}
                  onClick={() => refreshModels(preset.id)}
                >
                  <RotateCwIcon />
                </Button>
              </div>
              <CollapsibleContent>
                {view.models.length === 0 ? (
                  <p
                    className={cn(
                      "py-1 pr-2 pl-8 text-xs break-words",
                      view.error ? "text-destructive" : "text-muted-foreground"
                    )}
                  >
                    {view.status}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-0.5 py-1 pl-5">
                    {shown.map((model) => {
                      const isSelected =
                        selected?.providerId === preset.id &&
                        selected.model === model.id
                      return (
                        <li key={model.id}>
                          {onSelect ? (
                            <Button
                              variant={isSelected ? "secondary" : "ghost"}
                              size="sm"
                              className="w-full justify-start font-normal"
                              aria-pressed={isSelected}
                              title={model.id}
                              onClick={() => onSelect(preset.id, model.id)}
                            >
                              <CheckIcon
                                className={cn(!isSelected && "invisible")}
                              />
                              <span className="truncate">{model.id}</span>
                            </Button>
                          ) : (
                            <div
                              className="truncate px-3 py-1 text-[0.8rem]"
                              title={model.id}
                            >
                              {model.id}
                            </div>
                          )}
                        </li>
                      )
                    })}
                    {hidden > 0 && (
                      <li>
                        <Button
                          variant="link"
                          size="sm"
                          className="text-muted-foreground"
                          onClick={() =>
                            setShowAll((prev) => ({
                              ...prev,
                              [preset.id]: true,
                            }))
                          }
                        >
                          Show {hidden} more
                        </Button>
                      </li>
                    )}
                  </ul>
                )}
              </CollapsibleContent>
            </Collapsible>
          )
        })}
      </div>
    </div>
  )
}
