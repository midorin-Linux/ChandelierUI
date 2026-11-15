import { AppMenu } from "@/src/components/AppMenu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from "@/src/components/ui/sidebar"

export function AppSidebar({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <>
      <div className="flex w-12 shrink-0 flex-col items-center bg-sidebar py-2 text-sidebar-foreground md:hidden">
        <SidebarTrigger className="size-8" />
      </div>
      <Sidebar collapsible="icon">
        <SidebarHeader className="w-12 items-center px-0">
          <SidebarTrigger className="size-8 shrink-0" />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup />
          <SidebarGroup />
        </SidebarContent>
        <SidebarFooter className="p-1 border-t">
          <SidebarGroup className="p-0">
            <SidebarMenu>
              <SidebarMenuItem>
                <AppMenu onOpenSettings={onOpenSettings}>
                  <SidebarMenuButton>
                    <span>Chandelier UI</span>
                  </SidebarMenuButton>
                </AppMenu>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        </SidebarFooter>
      </Sidebar>
    </>
  )
}
