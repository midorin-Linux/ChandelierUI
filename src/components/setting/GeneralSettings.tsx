import { Tabs, TabsList, TabsTrigger } from "@/src/components/ui/tabs"
import { useTheme } from "@/src/components/ThemeProvider"

export function GeneralSettings() {
  const { theme, setTheme } = useTheme()

  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-sm font-medium">Theme</div>
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
  )
}
