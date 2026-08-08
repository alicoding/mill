import { create } from 'zustand'
import type { LabelProps } from '@primer/react'
import type { Workflow } from '../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { ViewKind } from '../bindings/github.com/alicoding/mill/internal/domain/capabilities/models'
import type { Capability } from '../bindings/github.com/alicoding/mill/internal/domain/capabilities/models'

// Which surface triggered a run -- 'trigger' covers every headless
// source (hotkey, schedule, clipboard-watch, filesystem-watch; see
// docs/SPEC.md §3.4), all of which fire through the one Go-emitted
// HotkeyActivity event (main.go/triggerservice.go) since none of them
// have any other feedback surface, the entire reason this feed exists;
// 'composition' is a direct Run-button click, which already has its own
// inline result/error UI, but still belongs in one shared feed so "did
// anything run" has a single place to look regardless of how it fired.
export type ActivitySource = 'trigger' | 'composition'

// A frontend-owned shape, not derived from the Go-emitted HotkeyActivity
// event (main.go) -- only the trigger source actually goes through that
// event; Composition Run-button clicks already resolve synchronously in
// the browser, so they push directly. label is resolved and stored at
// push time, not looked up later against `workflows` (which can drift,
// or have the entry deleted).
export interface ActivityEntry {
  id: string
  time: string
  // Date.now() at push time -- `time` is a toLocaleTimeString() display
  // string ("9:05:12 AM"), which sorts wrong lexicographically (e.g.
  // "10:..." < "9:..."). This is what ActivityView's DataTable actually
  // sorts on; `time` stays display-only.
  timestamp: number
  source: ActivitySource
  workflowID: string
  label: string
  binding?: string // only set for the hotkey trigger type specifically
  success: boolean
  detail: string
  result: string
}

// Discriminated union, not a plain string id: 'placeholder' always
// carries which capability it's standing in for, so PlaceholderView never
// has to guess or fall back to a default.
export type View =
  | { kind: 'activity' }
  | { kind: 'composition' }
  | { kind: 'configure' }
  | { kind: 'runs' }
  | { kind: 'settings' }
  | { kind: 'spec' }
  | { kind: 'placeholder'; capabilityId: string }

// Single mapping from a capability's Go-declared View to the frontend's
// own View union -- shared by the top nav and CapabilityIndex so both
// surfaces navigate identically instead of each re-deriving it.
export function viewFor(capability: Capability): View {
  switch (capability.View) {
    case ViewKind.ViewActivity:
      return { kind: 'activity' }
    case ViewKind.ViewComposition:
      return { kind: 'composition' }
    case ViewKind.ViewConfigure:
      return { kind: 'configure' }
    case ViewKind.ViewRuns:
      return { kind: 'runs' }
    default:
      return { kind: 'placeholder', capabilityId: capability.ID }
  }
}

export function viewsEqual(a: View, b: View): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'placeholder' && b.kind === 'placeholder') return a.capabilityId === b.capabilityId
  return true
}

// Shared by CapabilityIndex, PlaceholderView, and the sidebar nav --
// previously duplicated identically in the first two, DRYed up here
// rather than left as two (soon three) copies.
const STATUS_VARIANT: Record<string, LabelProps['variant']> = {
  LOCKED: 'success',
  OPEN: 'attention',
  PARKED: 'secondary',
}

export function statusVariant(status: string): LabelProps['variant'] {
  return STATUS_VARIANT[status] ?? 'secondary'
}

const MAX_ACTIVITY_ENTRIES = 50

interface AppState {
  workflows: Workflow[] | null
  activity: ActivityEntry[]
  capabilities: Capability[]
  view: View
  setWorkflows: (workflows: Workflow[]) => void
  pushActivity: (entry: ActivityEntry) => void
  setCapabilities: (capabilities: Capability[]) => void
  setView: (view: View) => void
}

// Shared across App/ActivityView/SpecView (SPEC.md §1.3): App.tsx still
// owns the data-fetching effects (CompositionService.Workflows(),
// CapabilitiesService.List(), the hotkey-activity event) since it's the
// one place every view mounts under, but the data itself lives here
// instead of being threaded down as props. `view` lives here too (not
// local useState in App.tsx) so the capability index rendered inside
// SpecView can navigate directly, without a callback prop threaded down.
// workflows is shared state (not CompositionView-local) specifically so
// App.tsx's hotkey-activity handler can resolve a fired workflow's label
// without its own separate fetch.
export const useAppStore = create<AppState>((set) => ({
  workflows: null,
  activity: [],
  capabilities: [],
  // Composition (the Workflows list) is the new landing page -- the
  // direct successor to what Runbook used to be (docs/SPEC.md §2.2's
  // Update note), not Activity, which is a secondary "what ran" view.
  view: { kind: 'composition' },
  setWorkflows: (workflows) => set({ workflows }),
  pushActivity: (entry) =>
    set((state) => ({ activity: [entry, ...state.activity].slice(0, MAX_ACTIVITY_ENTRIES) })),
  setCapabilities: (capabilities) => set({ capabilities }),
  setView: (view) => set({ view }),
}))
