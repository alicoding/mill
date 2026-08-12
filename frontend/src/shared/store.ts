import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { LabelProps } from '@primer/react'
import { CompositionService, ConfigureService, SettingsService } from './bindings'
import type { NodeType, Workflow } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import type { HTTPRequest } from '../../bindings/github.com/alicoding/mill/internal/domain/httprequest/models'
import { ViewKind } from '../../bindings/github.com/alicoding/mill/internal/domain/capabilities/models'
import type { Capability } from '../../bindings/github.com/alicoding/mill/internal/domain/capabilities/models'
import type { KeyCombo } from './keybinding'
import {
  isRestorable,
  migrateLegacyWorkTabs,
  modeForRestoredCanvasTab,
  sameWorkTarget,
  shouldUpgradeToEdit,
  type WorkTab,
  type WorkTabSpec,
} from './workTabs'

// Re-exported so every existing `from '../shared/store'` import of
// WorkTab/WorkTabSpec (app/WorkTabShell.tsx, composition/
// WorkflowEditorTab.tsx, etc.) keeps working unchanged -- the types
// themselves live in workTabs.ts now (split at the 500-line limit,
// CLAUDE.md).
export type { WorkTab, WorkTabSpec }

// Which surface triggered a run -- 'trigger' covers every headless
// source (hotkey, schedule, clipboard-watch, filesystem-watch; see
// docs/SPEC.md §3.4), all of which fire through the one Go-emitted
// HotkeyActivity event (main.go/triggerservice.go) since none of them
// have any other feedback surface, the entire reason this feed exists;
// 'composition' is a direct Run-button click, which already has its own
// inline result/error UI, but still belongs in one shared feed so "did
// anything run" has a single place to look regardless of how it fired.
// 'mcp-write' is a missed (timed-out) or denied MCP write import
// (docs/goals/0005-pending-attention-model.md item 3) -- no workflow of
// its own, pushed via the Go-emitted mcp-write-activity event.
export type ActivitySource = 'trigger' | 'composition' | 'mcp-write'

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
  | { kind: 'home' }
  | { kind: 'activity' }
  | { kind: 'review' }
  | { kind: 'composition' }
  // tab (goal 0015's remainder, QuickPanel's Configure-entity jump
  // rows): which ConfigureView sub-tab to land on ('integration' /
  // 'lists' / 'mcpservers' / ...), undefined = ConfigureView's own
  // default. Optional so every existing `{ kind: 'configure' }` call
  // site (sidebar nav, the ⌘K palette's view.configure command) stays
  // valid unchanged -- landing on whichever tab was last open there.
  | { kind: 'configure'; tab?: string }
  | { kind: 'settings' }
  | { kind: 'placeholder'; capabilityId: string }

// Single mapping from a capability's Go-declared View to the frontend's
// own View union -- shared by the sidebar nav so it navigates
// consistently instead of re-deriving this per call site.
export function viewFor(capability: Capability): View {
  switch (capability.View) {
    case ViewKind.ViewHome:
      return { kind: 'home' }
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

// Shared by PlaceholderView and the sidebar nav's status dot -- DRYed
// up here rather than left as separate copies.
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
  // Reuses an already-open tab for the same target (sameWorkTarget)
  // rather than opening a second one -- for a 'workflow-edit' target,
  // reuse NEVER downgrades an already-'edit' tab back to 'view' just
  // because a view-intent opener (a row click) asked for it again, but
  // DOES upgrade an existing 'view' tab to 'edit' when the opener's own
  // intent is explicitly edit (a pencil/menu action, mode: 'edit') --
  // see setWorkTabMode below for the same in-place switch driven from
  // inside an already-open tab's own Edit button.
  openWorkTab: (tab: WorkTabSpec) => void
  closeWorkTab: (key: string) => void
  // Bulk closers for the work-tab overflow menu (docs/goals/0018): close
  // every open work tab, or every one except keepKey. Scratch cleanup for
  // the closed keys stays WorkTabShell's job (this store has no scratch/
  // localStorage knowledge) -- it clears scratch for the removed keys
  // before calling these.
  closeAllWorkTabs: () => void
  closeOtherWorkTabs: (keepKey: string) => void
  activateWorkTab: (key: string | null) => void
  // Drops tabs whose entity no longer exists -- called by WorkTabShell
  // once real data is in, so a restored tab for a since-deleted
  // workflow/request doesn't linger as a ghost.
  pruneWorkTabs: (keep: (tab: WorkTab) => boolean) => void
  // requestOpenWorkflow opens (or reuses) a workflow's editor tab from
  // anywhere -- the hover-preview's Open, an Activity row -- via the
  // global strip. An optional runId (the Review page's row drill-down,
  // docs/goals/0002-review-queue-maturation.md item 5) additionally asks
  // that run to be preselected on the Runs inner tab once the editor
  // opens -- see pendingRunFocus below for how that's consumed.
  requestOpenWorkflow: (id: string, runId?: string) => void
  // The run a just-opened workflow editor should preselect on its Runs
  // inner tab, set by requestOpenWorkflow's optional runId and read by
  // WorkflowEditorTab/WorkflowRunsPanel. Consumed once (cleared via
  // consumePendingRunFocus) so switching tabs afterward, or reopening
  // the same workflow later, doesn't keep re-focusing a stale run.
  pendingRunFocus: { workflowId: string; runId: string } | null
  consumePendingRunFocus: () => void
  // Hot-exit UI signals (docs/goals/0012-authoring-hot-exit.md), keyed
  // by WorkTab.key -- pure state, no localStorage/scratch knowledge
  // here (that stays in composition/canvasScratch.ts; shared/ is a
  // dependency-cruiser leaf, §1.3, and can't import from composition/).
  // A canvas tab (composition/CompositionCanvas.tsx) writes into these;
  // app/WorkTabShell.tsx reads them to render the tab-strip dirty dot
  // and the "unsaved changes restored" banner.
  workTabDirty: Record<string, boolean>
  setWorkTabDirty: (key: string, dirty: boolean) => void
  // Switches an already-open 'workflow-edit' tab's mode in place
  // (docs/goals/0022-workflow-view-mode.md) -- the canvas's own "Edit"
  // button calls this directly by the tab's own key, never
  // close-then-reopen. Forward only (view -> edit); nothing currently
  // drives it the other way.
  setWorkTabMode: (key: string, mode: 'view' | 'edit') => void
  // Set true only when a tab's canvas was seeded from restored hot-exit
  // scratch that differed from the saved/starter baseline at mount --
  // never from ordinary in-session editing, so the banner only ever
  // means "this came back from before a reload/quit/crash," not "you
  // have unsaved changes" (workTabDirty already covers that). Dismissing
  // it is purely informational (dismissWorkTabRestored) -- it never
  // touches the underlying scratch, which keeps shadowing the draft
  // until Save or a deliberate close.
  workTabRestored: Record<string, boolean>
  setWorkTabRestored: (key: string, restored: boolean) => void
  dismissWorkTabRestored: (key: string) => void
  // Command-keybinding overrides (docs/goals/0016-keymap-system.md) --
  // shared/commands.ts's dispatcher and the Settings Keyboard Shortcuts
  // section both read this; SettingsService owns persistence, this is
  // just the last-fetched mirror. refreshKeybindings() (below) is the
  // one fetch path, same shape as refreshWorkflows/refreshRequests.
  keybindingOverrides: Record<string, KeyCombo>
  setKeybindingOverrides: (overrides: Record<string, KeyCombo>) => void
  // workflow.save/workflow.run (shared/commands.ts) can't import
  // composition/CompositionCanvas.tsx directly (dependency-cruiser
  // boundary, .claude/rules/frontend.md) -- this is the signal the
  // ACTIVE canvas tab watches and consumes, same "different view trees,
  // a store field beats a callback chain" shape as
  // openWorkflowRequest/requestOpenWorkflow above.
  canvasCommandRequest: 'save' | 'run' | null
  requestCanvasCommand: (command: 'save' | 'run') => void
  consumeCanvasCommandRequest: () => void
  // The ⌘K command palette (docs/goals/0015-summon-quick-invoke.md).
  // Lives here, not local useState in app/CommandPalette.tsx, because
  // the thing that opens it -- palette.open's `run` in shared/commands.ts
  // -- can't import a component from app/ (dependency-cruiser's
  // shared-is-a-leaf rule, .claude/rules/frontend.md); same
  // store-field-as-cross-tree-signal shape as canvasCommandRequest
  // above, just a plain boolean instead of a one-shot request.
  paletteOpen: boolean
  openPalette: () => void
  closePalette: () => void
  togglePalette: () => void
}

// Shared across App/ActivityView (SPEC.md §1.3): App.tsx still owns the
// data-fetching effects (CompositionService.Workflows(),
// CapabilitiesService.List(), the hotkey-activity event) since it's the
// one place every view mounts under, but the data itself lives here
// instead of being threaded down as props. `view` lives here too (not
// local useState in App.tsx) so any surface can navigate directly,
// without a callback prop threaded down.
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

// refreshKeybindings (docs/goals/0016-keymap-system.md) mirrors the
// shape above -- ListKeybindings returns raw {mods, key} per command id
// (settingsservice_keymap.go's own doc comment on why: so a default and
// an overridden binding render through the same frontend formatter,
// shared/keybinding.ts's formatCombo, rather than one pre-formatted by
// Go and one by the frontend independently). PersistedHotkey's fields
// are lowercase in the generated bindings (its Go struct carries real
// json tags, unlike trigger.HotkeyBinding's Mods/Key -- checked
// directly against the regenerated frontend/bindings, not assumed).
export function refreshKeybindings(): Promise<void> {
  return SettingsService.ListKeybindings()
    .then((map) => {
      const overrides: Record<string, KeyCombo> = {}
      for (const [id, hk] of Object.entries(map ?? {})) {
        if (!hk) continue
        overrides[id] = { mods: hk.mods ?? [], key: hk.key }
      }
      useAppStore.getState().setKeybindingOverrides(overrides)
    })
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
      // Home is the landing page (docs/goals/0014-home-dashboard.md,
      // docs/SPEC.md §3.2.3: "the reason to open Mill" -- value
      // accounting, usage mirror, what ran while the window was
      // closed), superseding Composition/Workflows as the default
      // (which held that role since §2.2's Update note, itself the
      // direct successor to Runbook). Only the *initial* default before
      // anything was ever persisted -- see the `persist` config below.
      view: { kind: 'home' },
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
          if (existing) {
            if (shouldUpgradeToEdit(existing, tab)) {
              return {
                activeWorkTabKey: existing.key,
                workTabs: state.workTabs.map((t) => (t.key === existing.key ? { ...t, mode: 'edit' as const } : t)),
              }
            }
            return { activeWorkTabKey: existing.key }
          }
          const created: WorkTab = { ...tab, key: crypto.randomUUID() }
          return { workTabs: [...state.workTabs, created], activeWorkTabKey: created.key }
        }),
      closeWorkTab: (key) =>
        set((state) => {
          const workTabDirty = { ...state.workTabDirty }
          delete workTabDirty[key]
          const workTabRestored = { ...state.workTabRestored }
          delete workTabRestored[key]
          return {
            workTabs: state.workTabs.filter((t) => t.key !== key),
            activeWorkTabKey: state.activeWorkTabKey === key ? null : state.activeWorkTabKey,
            workTabDirty,
            workTabRestored,
          }
        }),
      closeAllWorkTabs: () =>
        set({ workTabs: [], activeWorkTabKey: null, workTabDirty: {}, workTabRestored: {} }),
      closeOtherWorkTabs: (keepKey) =>
        set((state) => {
          const kept = state.workTabs.filter((t) => t.key === keepKey)
          if (kept.length === state.workTabs.length) return {}
          const workTabDirty = keepKey in state.workTabDirty ? { [keepKey]: state.workTabDirty[keepKey] } : {}
          const workTabRestored = keepKey in state.workTabRestored ? { [keepKey]: state.workTabRestored[keepKey] } : {}
          return {
            workTabs: kept,
            activeWorkTabKey: kept.length > 0 ? keepKey : null,
            workTabDirty,
            workTabRestored,
          }
        }),
      activateWorkTab: (key) => set({ activeWorkTabKey: key }),
      pruneWorkTabs: (keep) =>
        set((state) => {
          const workTabs = state.workTabs.filter(keep)
          if (workTabs.length === state.workTabs.length) return {}
          const stillActive = workTabs.some((t) => t.key === state.activeWorkTabKey)
          return { workTabs, activeWorkTabKey: stillActive ? state.activeWorkTabKey : null }
        }),
      pendingRunFocus: null,
      // Opens (or reuses, whatever mode it's currently in) a workflow's
      // tab from a jump/preview context -- hover-preview's Open, the
      // Review queue's row drill-down, Home's Most-used list. Defaults
      // a freshly-created tab to 'view' (docs/goals/0022): every one of
      // these callers is a "go look at this workflow" gesture (a run's
      // own data, a referenced child's layout), never an implicit edit
      // request -- an Edit button is one click away inside the opened
      // tab for whoever actually wants to change it.
      requestOpenWorkflow: (id, runId) =>
        set((state) => {
          const pendingRunFocus = runId ? { workflowId: id, runId } : null
          const existing = state.workTabs.find((t) => t.kind === 'workflow-edit' && t.workflowId === id)
          if (existing) return { activeWorkTabKey: existing.key, pendingRunFocus }
          const created: WorkTab = { key: crypto.randomUUID(), kind: 'workflow-edit', workflowId: id, mode: 'view' }
          return { workTabs: [...state.workTabs, created], activeWorkTabKey: created.key, pendingRunFocus }
        }),
      consumePendingRunFocus: () => set({ pendingRunFocus: null }),
      workTabDirty: {},
      setWorkTabDirty: (key, dirty) =>
        set((state) => {
          if ((state.workTabDirty[key] ?? false) === dirty) return {}
          return { workTabDirty: { ...state.workTabDirty, [key]: dirty } }
        }),
      setWorkTabMode: (key, mode) =>
        set((state) => ({
          workTabs: state.workTabs.map((t) => (t.key === key && t.kind === 'workflow-edit' ? { ...t, mode } : t)),
        })),
      workTabRestored: {},
      setWorkTabRestored: (key, restored) =>
        set((state) => ({ workTabRestored: { ...state.workTabRestored, [key]: restored } })),
      dismissWorkTabRestored: (key) =>
        set((state) => {
          const workTabRestored = { ...state.workTabRestored }
          delete workTabRestored[key]
          return { workTabRestored }
        }),
      keybindingOverrides: {},
      setKeybindingOverrides: (overrides) => set({ keybindingOverrides: overrides }),
      canvasCommandRequest: null,
      requestCanvasCommand: (command) => set({ canvasCommandRequest: command }),
      consumeCanvasCommandRequest: () => set({ canvasCommandRequest: null }),
      paletteOpen: false,
      openPalette: () => set({ paletteOpen: true }),
      closePalette: () => set({ paletteOpen: false }),
      togglePalette: () => set((state) => ({ paletteOpen: !state.paletteOpen })),
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
        // A 'workflow-edit' tab persisted before docs/goals/0022's
        // `mode` field existed carries no mode at all -- backfill it
        // rather than let it through undefined (every reader below
        // assumes mode is always set). scratchKeyExists is the same
        // conservative heuristic migrateLegacyWorkTabs uses: real
        // scratch data still sitting under this tab's own key means
        // there's real unsaved work to protect, so default to 'edit'
        // (the actual pre-goal behavior, no worse than before); nothing
        // there defaults to 'view', the safer choice (ADR-0014).
        const restored = (p.workTabs ?? []).filter(isRestorable).map((t) =>
          t.kind === 'workflow-edit' && t.mode === undefined
            ? { ...t, mode: modeForRestoredCanvasTab(t.key) }
            : t,
        )
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
