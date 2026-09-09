import type { StoreApi } from 'zustand'
import type { AppState } from './store'
import { newLocalID } from './localId'
import {
  nextActiveAfterClose,
  pruneRecentWorkTabKeys,
  pruneStaleWorkTabs,
  pushRecentWorkTabKey,
  sameWorkTarget,
  shouldUpgradeToEdit,
  type WorkTab,
  type WorkTabSpec,
} from './workTabs'

// The work-tab open/close/activate actions -- split out of store.ts once
// goal 0407's MRU-close tracking pushed it past the 500-line limit
// (.claude/rules/architecture.md), same "split along a real seam"
// discipline requestFormTabState.ts already established for the
// Integration form's Test action.
export interface WorkTabActionsState {
  // The app-wide work-tab strip (docs/SPEC.md §3.8). null active key =
  // the sidebar's current section page shows.
  workTabs: WorkTab[]
  activeWorkTabKey: string | null
  // Activation-order MRU stack (goal 0407), most recent last -- every
  // path that sets activeWorkTabKey to a real key pushes here (see
  // workTabs.ts's pushRecentWorkTabKey); closeWorkTab reads it to pick
  // the survivor when the closed tab was the active one.
  recentWorkTabKeys: string[]
  // Reuses an already-open tab for the same target (sameWorkTarget)
  // rather than opening a second one -- for a 'workflow-edit' target,
  // reuse NEVER downgrades an already-'edit' tab back to 'view' just
  // because a view-intent opener (a row click) asked for it again, but
  // DOES upgrade an existing 'view' tab to 'edit' when the opener's own
  // intent is explicitly edit (a pencil/menu action, mode: 'edit') --
  // see setWorkTabMode (store.ts) for the same in-place switch driven
  // from inside an already-open tab's own Edit button.
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
}

export function createWorkTabActions(set: StoreApi<AppState>['setState']): WorkTabActionsState {
  return {
    workTabs: [],
    activeWorkTabKey: null,
    recentWorkTabKeys: [],
    openWorkTab: (tab) =>
      set((state) => {
        const existing = state.workTabs.find((t) => sameWorkTarget(t, tab))
        if (existing) {
          const upgrade = shouldUpgradeToEdit(existing, tab)
          // A requested run (goal 0294) always lands on the existing
          // tab, even when nothing else about it changes.
          const runId = tab.kind === 'workflow-edit' ? tab.runId : undefined
          const recentWorkTabKeys = pushRecentWorkTabKey(state.recentWorkTabKeys, existing.key)
          if (upgrade || runId) {
            return {
              activeWorkTabKey: existing.key,
              recentWorkTabKeys,
              workTabs: state.workTabs.map((t) => (t.key === existing.key
                ? { ...t, ...(upgrade ? { mode: 'edit' as const } : {}), ...(runId ? { runId } : {}) }
                : t)),
            }
          }
          return { activeWorkTabKey: existing.key, recentWorkTabKeys }
        }
        const created: WorkTab = { ...tab, key: newLocalID() }
        return {
          workTabs: [...state.workTabs, created],
          activeWorkTabKey: created.key,
          recentWorkTabKeys: pushRecentWorkTabKey(state.recentWorkTabKeys, created.key),
        }
      }),
    closeWorkTab: (key) =>
      set((state) => {
        const workTabDirty = { ...state.workTabDirty }
        delete workTabDirty[key]
        const workTabRestored = { ...state.workTabRestored }
        delete workTabRestored[key]
        const requestFormTestReady = { ...state.requestFormTestReady }
        delete requestFormTestReady[key]
        const workTabs = state.workTabs.filter((t) => t.key !== key)
        return {
          workTabs,
          // goal 0407: only the ACTIVE tab's own close picks a
          // survivor -- closing an inactive tab never disturbs
          // what's showing.
          activeWorkTabKey: state.activeWorkTabKey === key
            ? nextActiveAfterClose(state.workTabs, state.recentWorkTabKeys, key)
            : state.activeWorkTabKey,
          recentWorkTabKeys: pruneRecentWorkTabKeys(state.recentWorkTabKeys, workTabs),
          workTabDirty,
          workTabRestored,
          requestFormTestReady,
        }
      }),
    closeAllWorkTabs: () =>
      set({ workTabs: [], activeWorkTabKey: null, recentWorkTabKeys: [], workTabDirty: {}, workTabRestored: {}, requestFormTestReady: {} }),
    closeOtherWorkTabs: (keepKey) =>
      set((state) => {
        const kept = state.workTabs.filter((t) => t.key === keepKey)
        if (kept.length === state.workTabs.length) return {}
        const workTabDirty = keepKey in state.workTabDirty ? { [keepKey]: state.workTabDirty[keepKey] } : {}
        const workTabRestored = keepKey in state.workTabRestored ? { [keepKey]: state.workTabRestored[keepKey] } : {}
        const requestFormTestReady = keepKey in state.requestFormTestReady ? { [keepKey]: state.requestFormTestReady[keepKey] } : {}
        return {
          workTabs: kept,
          activeWorkTabKey: kept.length > 0 ? keepKey : null,
          recentWorkTabKeys: pruneRecentWorkTabKeys(state.recentWorkTabKeys, kept),
          workTabDirty,
          workTabRestored,
          requestFormTestReady,
        }
      }),
    // A null key (activating the pinned page tab) records nothing --
    // recentWorkTabKeys only ever tracks real work-tab keys.
    activateWorkTab: (key) =>
      set((state) => ({
        activeWorkTabKey: key,
        recentWorkTabKeys: key === null ? state.recentWorkTabKeys : pushRecentWorkTabKey(state.recentWorkTabKeys, key),
      })),
    pruneWorkTabs: (keep) =>
      set((state) => pruneStaleWorkTabs(state.workTabs, state.activeWorkTabKey, state.recentWorkTabKeys, keep) ?? {}),
    pendingRunFocus: null,
    requestOpenWorkflow: (id, runId) =>
      set((state) => {
        const pendingRunFocus = runId ? { workflowId: id, runId } : null
        const existing = state.workTabs.find((t) => t.kind === 'workflow-edit' && t.workflowId === id)
        if (existing) {
          return {
            activeWorkTabKey: existing.key,
            recentWorkTabKeys: pushRecentWorkTabKey(state.recentWorkTabKeys, existing.key),
            pendingRunFocus,
          }
        }
        const created: WorkTab = { key: newLocalID(), kind: 'workflow-edit', workflowId: id, mode: 'view' }
        return {
          workTabs: [...state.workTabs, created],
          activeWorkTabKey: created.key,
          recentWorkTabKeys: pushRecentWorkTabKey(state.recentWorkTabKeys, created.key),
          pendingRunFocus,
        }
      }),
    consumePendingRunFocus: () => set({ pendingRunFocus: null }),
  }
}
