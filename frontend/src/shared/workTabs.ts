// The app-wide work-tab strip's own types + pure helpers (docs/SPEC.md
// §3.8, docs/goals/0022-workflow-view-mode.md) -- split out of store.ts
// once view mode pushed that file over the 500-line limit (CLAUDE.md),
// same "split along a real seam" discipline the composition/ hooks
// already established. store.ts re-exports the types so every existing
// `from '../shared/store'` import of WorkTab/WorkTabSpec keeps working
// unchanged; the store itself imports the functions directly.

// One app-wide work-tab strip (docs/SPEC.md §3.8, direct user decision:
// per-page tab strips "isolated the tabs between pages, which is
// incorrect model"). A WorkTab is an open work item -- a workflow
// editor or an integration view/edit -- rendered by app/WorkTabShell.tsx
// above whichever section page the sidebar has active; opening,
// closing, and switching tabs is store state so any surface (a list
// row, a hover-preview's Open, an Activity row) can open one without a
// callback chain.
// `mode` (docs/goals/0022): a 'workflow-edit' tab is ONE tab whose
// interaction surface switches in place between a read-only inspect
// view and the full editor -- never two separate tab kinds the way
// request-view/request-edit are (ADR-0014's split doesn't apply here by
// explicit goal design: "the same tab must switch modes in place...
// without closing/reopening"). Required, not optional, so every
// creation call site has to make the view-vs-edit call explicitly
// rather than silently defaulting one way.
export type WorkTabSpec =
  | { kind: 'workflow-edit'; workflowId: string; mode: 'view' | 'edit' }
  | { kind: 'workflow-new' }
  | { kind: 'request-view'; requestId: string }
  | { kind: 'request-edit'; requestId: string }
  | { kind: 'request-new'; duplicateFromId?: string }

export type WorkTab = WorkTabSpec & { key: string }

// Which persisted tabs restore across a reload: saved-entity tabs, plus
// 'workflow-new' -- never a 'request-edit'/'request-new' tab, whose
// unsaved in-progress form state is already gone (Configure forms stay
// out of hot exit's scope, docs/goals/0012-authoring-hot-exit.md; the
// only-'view'-tabs discipline still holds there). 'workflow-new' is the
// one exception: unlike a half-filled Configure form, its canvas state
// IS recoverable, via the same localStorage hot-exit scratch a
// 'workflow-edit' tab already restores from (canvasScratch.ts) -- so a
// brand-new, not-yet-saved workflow's tab now persists across reload
// too, not just already-saved ones.
export function isRestorable(tab: WorkTab): boolean {
  return tab.kind === 'workflow-edit' || tab.kind === 'request-view' || tab.kind === 'workflow-new'
}

// Raw localStorage existence check for a canvas tab's hot-exit scratch
// (composition/canvasScratch.ts's own SCRATCH_PREFIX, inlined rather
// than imported: shared/ is a dependency-cruiser leaf and cannot import
// from composition/, .claude/rules/frontend.md). Used ONLY to backfill
// `mode` on a persisted 'workflow-edit' tab saved before this field
// existed (see modeForRestoredCanvasTab and migrateLegacyWorkTabs) -- a
// conservative, existence-only check (not the fuller draftsEqual
// comparison composition/useCanvasHotExit.ts does, which needs
// nodeTypes/the saved workflow, neither available at merge-time): any
// scratch data at all defaults the tab to 'edit' (never worse than
// this migration's pre-goal status quo, which was always edit), no
// scratch defaults to 'view' (the safer default, ADR-0014's
// inspect-first principle) -- never risks silently orphaning a real
// unsaved edit behind a view tab that skips the scratch check entirely.
function scratchKeyExists(tabKey: string): boolean {
  try {
    return localStorage.getItem(`mill-canvas-scratch:${tabKey}`) !== null
  } catch {
    return false
  }
}

export function modeForRestoredCanvasTab(tabKey: string): 'view' | 'edit' {
  return scratchKeyExists(tabKey) ? 'edit' : 'view'
}

// One-time migration from the two per-page persistedTabs keys the
// global strip replaces -- real persisted state on real machines, so
// carried forward, not dropped (same discipline as ADR-0016's
// configure-connectors migration). The old keys are left in place,
// unread once the new key exists.
export function migrateLegacyWorkTabs(): WorkTab[] {
  try {
    const out: WorkTab[] = []
    const comp = JSON.parse(localStorage.getItem('mill-composition-tabs') ?? 'null') as { ids?: string[] } | null
    for (const id of comp?.ids ?? []) {
      // This ancient key format (mill-composition-tabs) predates the
      // hot-exit scratch mechanism itself (docs/goals/0012), which is
      // keyed by WorkTab.key -- a freshly minted key here can never
      // have a matching scratch entry, so there's nothing to check;
      // 'view' is simply the safer default (ADR-0014).
      out.push({ key: crypto.randomUUID(), kind: 'workflow-edit', workflowId: id, mode: 'view' })
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
export function sameWorkTarget(a: WorkTab, b: WorkTabSpec): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'workflow-edit' && b.kind === 'workflow-edit') return a.workflowId === b.workflowId
  if ((a.kind === 'request-view' && b.kind === 'request-view') || (a.kind === 'request-edit' && b.kind === 'request-edit')) {
    return a.requestId === b.requestId
  }
  return false
}

// The pure decision point behind reusing an already-open workflow tab
// (docs/goals/0022, store.ts's openWorkTab) -- exported and
// unit-tested on its own (workTabs.test.ts) since it's the one rule
// the whole row-click-vs-Edit-action grammar hinges on: an explicit
// edit REQUEST (mode: 'edit' -- a pencil/menu action, the palette's
// "Open in editor") upgrades an already-open VIEW tab to edit in
// place, but a plain view request (a row click) reusing an already-EDIT
// tab must never silently downgrade it and drop whatever's being
// edited.
export function shouldUpgradeToEdit(existing: WorkTab, requested: WorkTabSpec): boolean {
  return (
    existing.kind === 'workflow-edit'
    && requested.kind === 'workflow-edit'
    && requested.mode === 'edit'
    && existing.mode !== 'edit'
  )
}
