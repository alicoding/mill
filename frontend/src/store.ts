import { create } from 'zustand'
import type { HotkeyActivity } from '../bindings/github.com/alicoding/mill/models'
import type { Action } from '../bindings/github.com/alicoding/mill/internal/domain/runbook/models'
import { ViewKind } from '../bindings/github.com/alicoding/mill/internal/domain/capabilities/models'
import type { Capability } from '../bindings/github.com/alicoding/mill/internal/domain/capabilities/models'

export type ActivityEntry = HotkeyActivity & { id: string; time: string }

// Discriminated union, not a plain string id: 'placeholder' always
// carries which capability it's standing in for, so PlaceholderView never
// has to guess or fall back to a default.
export type View =
  | { kind: 'runbook' }
  | { kind: 'activity' }
  | { kind: 'spec' }
  | { kind: 'placeholder'; capabilityId: string }

// Single mapping from a capability's Go-declared View to the frontend's
// own View union -- shared by the top nav and CapabilityIndex so both
// surfaces navigate identically instead of each re-deriving it.
export function viewFor(capability: Capability): View {
  switch (capability.View) {
    case ViewKind.ViewRunbook:
      return { kind: 'runbook' }
    case ViewKind.ViewActivity:
      return { kind: 'activity' }
    default:
      return { kind: 'placeholder', capabilityId: capability.ID }
  }
}

export function viewsEqual(a: View, b: View): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'placeholder' && b.kind === 'placeholder') return a.capabilityId === b.capabilityId
  return true
}

const MAX_ACTIVITY_ENTRIES = 50

interface AppState {
  actions: Action[] | null
  activity: ActivityEntry[]
  capabilities: Capability[]
  view: View
  setActions: (actions: Action[]) => void
  pushActivity: (entry: ActivityEntry) => void
  setCapabilities: (capabilities: Capability[]) => void
  setView: (view: View) => void
}

// Shared across App/RunbookView/ActivityView/SpecView (SPEC.md §1.3):
// App.tsx still owns the data-fetching effects (RunbookService.List(),
// CapabilitiesService.List(), the hotkey-activity event) since it's the
// one place every view mounts under, but the data itself lives here
// instead of being threaded down as props. `view` lives here too (not
// local useState in App.tsx) so the capability index rendered inside
// SpecView can navigate directly, without a callback prop threaded down.
export const useAppStore = create<AppState>((set) => ({
  actions: null,
  activity: [],
  capabilities: [],
  view: { kind: 'runbook' },
  setActions: (actions) => set({ actions }),
  pushActivity: (entry) =>
    set((state) => ({ activity: [entry, ...state.activity].slice(0, MAX_ACTIVITY_ENTRIES) })),
  setCapabilities: (capabilities) => set({ capabilities }),
  setView: (view) => set({ view }),
}))
