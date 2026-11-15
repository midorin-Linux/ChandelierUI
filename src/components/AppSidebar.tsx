import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarTrigger,
} from "@/src/components/ui/sidebar"

export function AppSidebar() {
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
        <SidebarFooter></SidebarFooter>
      </Sidebar>
    </>
  )
}
