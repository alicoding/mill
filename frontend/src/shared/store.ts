import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { LabelProps } from '@primer/react'
import { CompositionService, ConfigureService } from '../../bindings/github.com/alicoding/mill'
import type { NodeType, Workflow } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import type { HTTPRequest } from '../../bindings/github.com/alicoding/mill/internal/domain/httprequest/models'
import { ViewKind } from '../../bindings/github.com/alicoding/mill/internal/domain/capabilities/models'
import type { Capability } from '../../bindings/github.com/alicoding/mill/internal/domain/capabilities/models'

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
  | { kind: 'review' }
  | { kind: 'composition' }
  | { kind: 'configure' }
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
    case ViewKind.ViewReview:
      return { kind: 'review' }
    case ViewKind.ViewComposition:
      return { kind: 'composition' }
    case ViewKind.ViewConfigure:
      return { kind: 'configure' }
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

// Same three-way status mapping as statusVariant, expressed as a
// fgColor token instead of a Label variant -- for the sidebar's dot
// indicator (RunsView.tsx's STEP_ICON already colors an Octicon this
// same way via a direct `fill` prop, the established pattern here).
const STATUS_DOT_COLOR: Record<string, string> = {
  LOCKED: 'var(--fgColor-success)',
  OPEN: 'var(--fgColor-attention)',
  PARKED: 'var(--fgColor-muted)',
}

export function statusDotColor(status: string): string {
  return STATUS_DOT_COLOR[status] ?? 'var(--fgColor-muted)'
}

const MAX_ACTIVITY_ENTRIES = 50

// One app-wide work-tab strip (docs/SPEC.md §3.8, direct user decision:
// per-page tab strips "isolated the tabs between pages, which is
// incorrect model"). A WorkTab is an open work item -- a workflow
// editor or an integration view/edit -- rendered by app/WorkTabShell.tsx
// above whichever section page the sidebar has active; opening,
// closing, and switching tabs is store state so any surface (a list
// row, a hover-preview's Open, an Activity row) can open one without a
// callback chain.
export type WorkTabSpec =
  | { kind: 'workflow-edit'; workflowId: string }
  | { kind: 'workflow-new' }
  | { kind: 'request-view'; requestId: string }
  | { kind: 'request-edit'; requestId: string }
  | { kind: 'request-new'; duplicateFromId?: string }

export type WorkTab = WorkTabSpec & { key: string }

// Which persisted tabs restore across a reload: saved-entity tabs only
// -- never a '-new' or 'request-edit' tab, whose unsaved in-progress
// state is already gone (the same only-'view'-tabs discipline the old
// per-page persistence had; workflow-edit is the canvas over a SAVED
// workflow, so it restores like before).
function isRestorable(tab: WorkTab): boolean {
  return tab.kind === 'workflow-edit' || tab.kind === 'request-view'
}

// One-time migration from the two per-page persistedTabs keys the
// global strip replaces -- real persisted state on real machines, so
// carried forward, not dropped (same discipline as ADR-0016's
// configure-connectors migration). The old keys are left in place,
// unread once the new key exists.
function migrateLegacyWorkTabs(): WorkTab[] {
  try {
    const out: WorkTab[] = []
    const comp = JSON.parse(localStorage.getItem('mill-composition-tabs') ?? 'null') as { ids?: string[] } | null
    for (const id of comp?.ids ?? []) {
      out.push({ key: crypto.randomUUID(), kind: 'workflow-edit', workflowId: id })
    }
    const req = JSON.parse(localStorage.getItem('mill-configure-request-tabs') ?? 'null') as { ids?: string[] } | null
    for (const id of req?.ids ?? []) {
      out.push({ key: crypto.randomUUID(), kind: 'request-view', requestId: id })
    }
    return out
  } catch {
    return []
  }
}

// Reuse-if-open matching (the same one-tab-per-entity rule both old
// per-page systems had): a saved entity opens at most one tab per
// kind; '-new' tabs are always fresh.
function sameWorkTarget(a: WorkTab, b: WorkTabSpec): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'workflow-edit' && b.kind === 'workflow-edit') return a.workflowId === b.workflowId
  if ((a.kind === 'request-view' && b.kind === 'request-view') || (a.kind === 'request-edit' && b.kind === 'request-edit')) {
    return a.requestId === b.requestId
  }
  return false
}

interface AppState {
  workflows: Workflow[] | null
  // nodeTypes/requests join workflows as store-shared server data (one
  // fetch, many consumers) now that the global work-tab shell renders
  // editors outside the pages that used to own these fetches.
  nodeTypes: NodeType[] | null
  requests: HTTPRequest[] | null
  activity: ActivityEntry[]
  capabilities: Capability[]
  view: View
  setWorkflows: (workflows: Workflow[]) => void
  setNodeTypes: (nodeTypes: NodeType[]) => void
  setRequests: (requests: HTTPRequest[]) => void
  pushActivity: (entry: ActivityEntry) => void
  setCapabilities: (capabilities: Capability[]) => void
  setView: (view: View) => void
  // The app-wide work-tab strip (docs/SPEC.md §3.8). null active key =
  // the sidebar's current section page shows.
  workTabs: WorkTab[]
  activeWorkTabKey: string | null
  openWorkTab: (tab: WorkTabSpec) => void
  closeWorkTab: (key: string) => void
  activateWorkTab: (key: string | null) => void
  // Drops tabs whose entity no longer exists -- called by WorkTabShell
  // once real data is in, so a restored tab for a since-deleted
  // workflow/request doesn't linger as a ghost.
  pruneWorkTabs: (keep: (tab: WorkTab) => boolean) => void
  // requestOpenWorkflow opens (or reuses) a workflow's editor tab from
  // anywhere -- the hover-preview's Open, an Activity row -- via the
  // global strip.
  requestOpenWorkflow: (id: string) => void
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
// zustand's own official persist middleware (zustand/middleware,
// already a transitive part of the already-adopted zustand dependency
// -- no new package), not a hand-rolled localStorage read/write pair:
// this is the same "adopt, don't reinvent a solved problem" bias
// CLAUDE.md already applies everywhere else, one level down inside a
// library Mill already depends on. `partialize` persists only `view` --
// workflows/activity/capabilities are live, server-derived or
// session-only data (refetched every mount, or explicitly a 50-entry
// ring buffer), not navigational state, and persisting them would be
// both wrong (stale data shown before the real fetch lands) and
// pointless (docs/SPEC.md §3.7's Update: "active view" is the concrete
// gap this closes, at the same localStorage/cosmetic tier
// theme/sidebar-collapse already established -- pure UI navigation
// state with no domain meaning outside the running app).
// The one refetch path for each shared list -- callable from any
// surface (a page's mount, a work tab's onSaved) without prop
// threading; writes land in the store for every consumer at once.
export function refreshWorkflows(): Promise<void> {
  return CompositionService.Workflows()
    .then((list) => useAppStore.getState().setWorkflows(list ?? []))
    .catch(console.error)
}

export function refreshRequests(): Promise<void> {
  return ConfigureService.HTTPRequests()
    .then((list) => useAppStore.getState().setRequests(list ?? []))
    .catch(console.error)
}

export function refreshNodeTypes(): Promise<void> {
  return CompositionService.NodeTypes()
    .then((list) => useAppStore.getState().setNodeTypes(list ?? []))
    .catch(console.error)
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      workflows: null,
      nodeTypes: null,
      requests: null,
      activity: [],
      capabilities: [],
      // Composition (the Workflows list) is the new landing page -- the
      // direct successor to what Runbook used to be (docs/SPEC.md
      // §2.2's Update note), not Activity, which is a secondary "what
      // ran" view. Only the *initial* default before anything was ever
      // persisted -- see the `persist` config below.
      view: { kind: 'composition' },
      setWorkflows: (workflows) => set({ workflows }),
      setNodeTypes: (nodeTypes) => set({ nodeTypes }),
      setRequests: (requests) => set({ requests }),
      pushActivity: (entry) =>
        set((state) => ({ activity: [entry, ...state.activity].slice(0, MAX_ACTIVITY_ENTRIES) })),
      setCapabilities: (capabilities) => set({ capabilities }),
      // Navigating sections deliberately deactivates the active work
      // tab (it stays open in the strip): clicking a sidebar item or
      // pressing a view hotkey means "show me that page."
      setView: (view) => set({ view, activeWorkTabKey: null }),
      workTabs: [],
      activeWorkTabKey: null,
      openWorkTab: (tab) =>
        set((state) => {
          const existing = state.workTabs.find((t) => sameWorkTarget(t, tab))
          if (existing) return { activeWorkTabKey: existing.key }
          const created: WorkTab = { ...tab, key: crypto.randomUUID() }
          return { workTabs: [...state.workTabs, created], activeWorkTabKey: created.key }
        }),
      closeWorkTab: (key) =>
        set((state) => ({
          workTabs: state.workTabs.filter((t) => t.key !== key),
          activeWorkTabKey: state.activeWorkTabKey === key ? null : state.activeWorkTabKey,
        })),
      activateWorkTab: (key) => set({ activeWorkTabKey: key }),
      pruneWorkTabs: (keep) =>
        set((state) => {
          const workTabs = state.workTabs.filter(keep)
          if (workTabs.length === state.workTabs.length) return {}
          const stillActive = workTabs.some((t) => t.key === state.activeWorkTabKey)
          return { workTabs, activeWorkTabKey: stillActive ? state.activeWorkTabKey : null }
        }),
      requestOpenWorkflow: (id) =>
        set((state) => {
          const existing = state.workTabs.find((t) => t.kind === 'workflow-edit' && t.workflowId === id)
          if (existing) return { activeWorkTabKey: existing.key }
          const created: WorkTab = { key: crypto.randomUUID(), kind: 'workflow-edit', workflowId: id }
          return { workTabs: [...state.workTabs, created], activeWorkTabKey: created.key }
        }),
    }),
    {
      name: 'mill-app-view',
      partialize: (state) => ({
        view: state.view,
        // Restorable work tabs only (saved-entity tabs; see
        // isRestorable) -- the active key isn't persisted: landing on
        // the section page with the strip populated is the less
        // surprising restore than landing inside an editor.
        workTabs: state.workTabs.filter(isRestorable),
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>
        const restored = (p.workTabs ?? []).filter(isRestorable)
        return {
          ...current,
          ...p,
          workTabs: restored.length > 0 ? restored : migrateLegacyWorkTabs(),
          activeWorkTabKey: null,
        }
      },
    },
  ),
)
