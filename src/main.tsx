import React from "react"
import ReactDOM from "react-dom/client"
import { getCurrentWindow } from "@tauri-apps/api/window"
import App from "@/src/App"
import { desktop, settingsWriter } from "@/src/lib/api"
import { session } from "@/src/stores/chat"

// One handler, so the window closes only after both writes land.
// It must not reject, or the window would stay open.
if (desktop) {
  void getCurrentWindow().onCloseRequested(async () => {
    await Promise.all([
      settingsWriter.flush(),
      session
        .flush()
        .catch((cause) =>
          console.error("Could not save before closing", cause)
        ),
    ])
  })
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
