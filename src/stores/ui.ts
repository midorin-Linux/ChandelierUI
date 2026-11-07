import { create } from "zustand"

interface UiState {
  selectedSessionId: string | null
  selectSession: (sessionId: string | null) => void
}

export const useUiStore = create<UiState>((set) => ({
  selectedSessionId: null,
  selectSession: (selectedSessionId) => set({ selectedSessionId }),
}))
