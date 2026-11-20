import { Tabs, TabsList, TabsTrigger } from "@/src/components/ui/tabs"
import { useTheme } from "@/src/components/ThemeProvider"
import {Separator} from "@/src/components/ui/separator.tsx";

export function GeneralSettings() {
  const { theme, setTheme } = useTheme()

  return (
    <div className="flex flex-col gap-8">
      {/*Appearance*/}
      <div className="flex flex-col gap-2">
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
      <div className="flex flex-col gap-2">
        <h3 className="text-base font-semibold">Session</h3>
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
    </div>
  )
}
