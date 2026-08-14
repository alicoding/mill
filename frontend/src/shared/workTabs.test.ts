import { describe, expect, it } from 'vitest'
import {
  activeKeyIfPresent,
  dirtyKeysForCloseRequest,
  pruneStaleWorkTabs,
  restoreWorkTabSnapshot,
  shouldUpgradeToEdit,
  type WorkTab,
} from './workTabs'

// docs/goals/0022-workflow-view-mode.md: the pure decision behind
// reusing an already-open workflow-edit tab -- an explicit edit
// request upgrades an open VIEW tab in place, but a plain view request
// (a row click) must never downgrade an already-open EDIT tab and drop
// in-progress editing.

function viewTab(workflowId: string): WorkTab {
  return { key: 'k1', kind: 'workflow-edit', workflowId, mode: 'view' }
}

function editTab(workflowId: string): WorkTab {
  return { key: 'k1', kind: 'workflow-edit', workflowId, mode: 'edit' }
}

describe('shouldUpgradeToEdit', () => {
  it('upgrades an open view tab when the request is explicitly edit', () => {
    expect(shouldUpgradeToEdit(viewTab('wf1'), { kind: 'workflow-edit', workflowId: 'wf1', mode: 'edit' })).toBe(true)
  })

  it('never downgrades an open edit tab when the request is a plain view (row click)', () => {
    expect(shouldUpgradeToEdit(editTab('wf1'), { kind: 'workflow-edit', workflowId: 'wf1', mode: 'view' })).toBe(false)
  })

  it('is a no-op reusing an already-view tab with another view request', () => {
    expect(shouldUpgradeToEdit(viewTab('wf1'), { kind: 'workflow-edit', workflowId: 'wf1', mode: 'view' })).toBe(false)
  })

  it('is a no-op reusing an already-edit tab with another edit request', () => {
    expect(shouldUpgradeToEdit(editTab('wf1'), { kind: 'workflow-edit', workflowId: 'wf1', mode: 'edit' })).toBe(false)
  })

  it('never upgrades a different WorkTab kind (workflow-new has no mode at all)', () => {
    expect(shouldUpgradeToEdit(viewTab('wf1'), { kind: 'workflow-new' })).toBe(false)
  })
})

// docs/goals/0033-reload-session-restore.md: a hard reload mid-session
// must restore the same open work tabs AND the same active one, never
// silently degrade into a crash or a dangling key when the snapshot
// turns out to be stale (a workflow deleted since it was taken).

function tabAt(key: string, workflowId: string): WorkTab {
  return { key, kind: 'workflow-edit', workflowId, mode: 'view' }
}

describe('activeKeyIfPresent', () => {
  it('keeps a key that matches a tab in the list', () => {
    const tabs = [tabAt('k1', 'wf1'), tabAt('k2', 'wf2')]
    expect(activeKeyIfPresent(tabs, 'k2')).toBe('k2')
  })

  it('degrades to null when the key matches nothing in the list', () => {
    const tabs = [tabAt('k1', 'wf1')]
    expect(activeKeyIfPresent(tabs, 'stale-key')).toBeNull()
  })

  it('degrades to null for a null/undefined key', () => {
    const tabs = [tabAt('k1', 'wf1')]
    expect(activeKeyIfPresent(tabs, null)).toBeNull()
    expect(activeKeyIfPresent(tabs, undefined)).toBeNull()
  })
})

describe('restoreWorkTabSnapshot', () => {
  it('restores the same tabs and the same active tab from a valid snapshot', () => {
    const persisted = [tabAt('k1', 'wf1'), tabAt('k2', 'wf2'), tabAt('k3', 'wf3')]
    const { workTabs, activeWorkTabKey } = restoreWorkTabSnapshot(persisted, 'k3')
    expect(workTabs).toEqual(persisted)
    expect(activeWorkTabKey).toBe('k3')
  })

  it('degrades gracefully when the persisted active key points at a since-removed tab', () => {
    // e.g. the active tab at snapshot time was a 'request-edit' --
    // filtered out by isRestorable -- so it never appears in the
    // restored list at all; the active key must not dangle on it.
    const persisted: WorkTab[] = [tabAt('k1', 'wf1')]
    const { workTabs, activeWorkTabKey } = restoreWorkTabSnapshot(persisted, 'stale-key')
    expect(workTabs).toEqual(persisted)
    expect(activeWorkTabKey).toBeNull()
  })

  it('backfills a missing mode on a pre-goal-0022 workflow-edit tab', () => {
    const legacy = [{ key: 'k1', kind: 'workflow-edit', workflowId: 'wf1' } as unknown as WorkTab]
    const { workTabs } = restoreWorkTabSnapshot(legacy, null)
    expect(workTabs[0]).toMatchObject({ kind: 'workflow-edit', workflowId: 'wf1' })
    expect((workTabs[0] as { mode: string }).mode).toBe('view')
  })

  it('falls back to the legacy-tab migration, with a null active key, when nothing restorable survives', () => {
    const { workTabs, activeWorkTabKey } = restoreWorkTabSnapshot(undefined, 'k1')
    expect(workTabs).toEqual([])
    expect(activeWorkTabKey).toBeNull()
  })
})

describe('pruneStaleWorkTabs', () => {
  it('returns null (no-op) when every tab is kept', () => {
    const tabs = [tabAt('k1', 'wf1'), tabAt('k2', 'wf2')]
    expect(pruneStaleWorkTabs(tabs, 'k1', () => true)).toBeNull()
  })

  it('drops a tab whose backing workflow no longer exists, keeping the still-valid active key', () => {
    const tabs = [tabAt('k1', 'wf1'), tabAt('k2', 'wf2')]
    const existingIds = new Set(['wf1'])
    const result = pruneStaleWorkTabs(tabs, 'k1', (t) => t.kind !== 'workflow-edit' || existingIds.has(t.workflowId))
    expect(result).toEqual({ workTabs: [tabAt('k1', 'wf1')], activeWorkTabKey: 'k1' })
  })

  it('clears the active key when the ACTIVE tab is exactly the one dropped (stale-snapshot degradation)', () => {
    const tabs = [tabAt('k1', 'wf1'), tabAt('k2', 'wf2')]
    const existingIds = new Set(['wf1'])
    const result = pruneStaleWorkTabs(tabs, 'k2', (t) => t.kind !== 'workflow-edit' || existingIds.has(t.workflowId))
    expect(result).toEqual({ workTabs: [tabAt('k1', 'wf1')], activeWorkTabKey: null })
  })
})

// docs/goals/0048-unsaved-close-guard.md: the pure decision behind
// whether a close request needs to prompt at all -- an empty result
// means the request closes silently.
describe('dirtyKeysForCloseRequest', () => {
  const tabs = [tabAt('k1', 'wf1'), tabAt('k2', 'wf2'), tabAt('k3', 'wf3')]

  it('kind "one": returns the key when that single tab is dirty', () => {
    expect(dirtyKeysForCloseRequest(tabs, { k1: true }, { kind: 'one', key: 'k1' })).toEqual(['k1'])
  })

  it('kind "one": returns nothing when that single tab is clean', () => {
    expect(dirtyKeysForCloseRequest(tabs, { k2: true }, { kind: 'one', key: 'k1' })).toEqual([])
  })

  it('kind "all": returns every dirty key regardless of position', () => {
    expect(dirtyKeysForCloseRequest(tabs, { k1: true, k3: true }, { kind: 'all' })).toEqual(['k1', 'k3'])
  })

  it('kind "all": returns nothing when every tab is clean', () => {
    expect(dirtyKeysForCloseRequest(tabs, {}, { kind: 'all' })).toEqual([])
  })

  it('kind "others": excludes the kept tab even when it is itself dirty', () => {
    expect(dirtyKeysForCloseRequest(tabs, { k1: true, k2: true }, { kind: 'others', keepKey: 'k1' })).toEqual(['k2'])
  })

  it('kind "others": returns nothing when only the kept tab is dirty', () => {
    expect(dirtyKeysForCloseRequest(tabs, { k1: true }, { kind: 'others', keepKey: 'k1' })).toEqual([])
  })
})
