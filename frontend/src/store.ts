import { create } from 'zustand'
import type { HotkeyActivity } from '../bindings/github.com/alicoding/mill/models'
import type { Action } from '../bindings/github.com/alicoding/mill/internal/domain/runbook/models'

export type ActivityEntry = HotkeyActivity & { id: string; time: string }

const MAX_ACTIVITY_ENTRIES = 50

interface AppState {
  actions: Action[] | null
  activity: ActivityEntry[]
  setActions: (actions: Action[]) => void
  pushActivity: (entry: ActivityEntry) => void
}

// Shared across App/RunbookView/ActivityView (SPEC.md §1.3): App.tsx still
// owns the two subscriptions that feed this (RunbookService.List(), the
// hotkey-activity event) since it's the one place both views mount under,
// but the data itself lives here instead of being threaded down as props.
export const useAppStore = create<AppState>((set) => ({
  actions: null,
  activity: [],
  setActions: (actions) => set({ actions }),
  pushActivity: (entry) =>
    set((state) => ({ activity: [entry, ...state.activity].slice(0, MAX_ACTIVITY_ENTRIES) })),
}))
