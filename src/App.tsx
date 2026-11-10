import "./App.css"
import { SidebarProvider } from "@/src/components/ui/sidebar.tsx"
import { SessionSidebar } from "@/src/components/session-sidebar.tsx"

function App() {
  return (
    <>
      <SidebarProvider>
        <SessionSidebar />
      </SidebarProvider>
    </>
  )
}

export default App
