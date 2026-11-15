import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/src/components/ui/dropdown-menu"
import { Button } from "@/src/components/ui/button"
import { useTheme } from "@/src/components/ThemeProvider"

export function ThemeMenu() {
  const { theme, setTheme } = useTheme()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" aria-label="Theme">
          Theme: {theme}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-36">
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => {
            if (value === "system" || value === "light" || value === "dark")
              setTheme(value)
          }}
        >
          {(["system", "light", "dark"] as const).map((value) => (
            <DropdownMenuRadioItem key={value} value={value}>
              {value}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
