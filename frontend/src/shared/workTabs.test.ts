import { describe, expect, it } from 'vitest'
import {
  activeKeyIfPresent,
  dirtyKeysForCloseRequest,
  nextActiveAfterClose,
  pruneRecentWorkTabKeys,
  pruneStaleWorkTabs,
  pushRecentWorkTabKey,
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
  it('restores the same tabs, the same active tab, and the same recency order from a valid snapshot', () => {
    const persisted = [tabAt('k1', 'wf1'), tabAt('k2', 'wf2'), tabAt('k3', 'wf3')]
    const { workTabs, activeWorkTabKey, recentWorkTabKeys } = restoreWorkTabSnapshot(persisted, 'k3', ['k1', 'k2', 'k3'])
    expect(workTabs).toEqual(persisted)
    expect(activeWorkTabKey).toBe('k3')
    expect(recentWorkTabKeys).toEqual(['k1', 'k2', 'k3'])
  })

  it('degrades gracefully when the persisted active key points at a since-removed tab', () => {
    // e.g. the active tab at snapshot time was a 'request-edit' --
    // filtered out by isRestorable -- so it never appears in the
    // restored list at all; the active key must not dangle on it.
    const persisted: WorkTab[] = [tabAt('k1', 'wf1')]
    const { workTabs, activeWorkTabKey } = restoreWorkTabSnapshot(persisted, 'stale-key', ['k1'])
    expect(workTabs).toEqual(persisted)
    expect(activeWorkTabKey).toBeNull()
  })

  it('drops a recent key whose tab did not survive restoration, same as a stale active key', () => {
    const persisted: WorkTab[] = [tabAt('k1', 'wf1')]
    const { recentWorkTabKeys } = restoreWorkTabSnapshot(persisted, 'k1', ['k1', 'stale-key'])
    expect(recentWorkTabKeys).toEqual(['k1'])
  })

  it('backfills a missing mode on a pre-goal-0022 workflow-edit tab', () => {
    const legacy = [{ key: 'k1', kind: 'workflow-edit', workflowId: 'wf1' } as unknown as WorkTab]
    const { workTabs } = restoreWorkTabSnapshot(legacy, null, undefined)
    expect(workTabs[0]).toMatchObject({ kind: 'workflow-edit', workflowId: 'wf1' })
    expect((workTabs[0] as { mode: string }).mode).toBe('view')
  })

  it('falls back to the legacy-tab migration, with a null active key and no recency, when nothing restorable survives', () => {
    const { workTabs, activeWorkTabKey, recentWorkTabKeys } = restoreWorkTabSnapshot(undefined, 'k1', ['k1'])
    expect(workTabs).toEqual([])
    expect(activeWorkTabKey).toBeNull()
    expect(recentWorkTabKeys).toEqual([])
  })
})

describe('pruneStaleWorkTabs', () => {
  it('returns null (no-op) when every tab is kept', () => {
    const tabs = [tabAt('k1', 'wf1'), tabAt('k2', 'wf2')]
    expect(pruneStaleWorkTabs(tabs, 'k1', ['k1', 'k2'], () => true)).toBeNull()
  })

  it('drops a tab whose backing workflow no longer exists, keeping the still-valid active key and pruning its recent entry', () => {
    const tabs = [tabAt('k1', 'wf1'), tabAt('k2', 'wf2')]
    const existingIds = new Set(['wf1'])
    const result = pruneStaleWorkTabs(tabs, 'k1', ['k2', 'k1'], (t) => t.kind !== 'workflow-edit' || existingIds.has(t.workflowId))
    expect(result).toEqual({ workTabs: [tabAt('k1', 'wf1')], activeWorkTabKey: 'k1', recentWorkTabKeys: ['k1'] })
  })

  it('clears the active key when the ACTIVE tab is exactly the one dropped (stale-snapshot degradation)', () => {
    const tabs = [tabAt('k1', 'wf1'), tabAt('k2', 'wf2')]
    const existingIds = new Set(['wf1'])
    const result = pruneStaleWorkTabs(tabs, 'k2', ['k1', 'k2'], (t) => t.kind !== 'workflow-edit' || existingIds.has(t.workflowId))
    expect(result).toEqual({ workTabs: [tabAt('k1', 'wf1')], activeWorkTabKey: null, recentWorkTabKeys: ['k1'] })
  })
})

// docs/goals/0407-tab-close-activation.md: the MRU push every
// activation path shares.
describe('pushRecentWorkTabKey', () => {
  it('appends a not-yet-seen key to the end', () => {
    expect(pushRecentWorkTabKey(['k1', 'k2'], 'k3')).toEqual(['k1', 'k2', 'k3'])
  })

  it('moves an already-present key to the end instead of duplicating it', () => {
    expect(pushRecentWorkTabKey(['k1', 'k2', 'k3'], 'k1')).toEqual(['k2', 'k3', 'k1'])
  })

  it('starts the stack from empty', () => {
    expect(pushRecentWorkTabKey([], 'k1')).toEqual(['k1'])
  })
})

describe('pruneRecentWorkTabKeys', () => {
  it('drops keys with no matching tab, keeping order', () => {
    const tabs = [tabAt('k1', 'wf1'), tabAt('k3', 'wf3')]
    expect(pruneRecentWorkTabKeys(['k1', 'k2', 'k3'], tabs)).toEqual(['k1', 'k3'])
  })

  it('empties when no tabs remain', () => {
    expect(pruneRecentWorkTabKeys(['k1', 'k2'], [])).toEqual([])
  })
})

// docs/goals/0407-tab-close-activation.md: which tab activates when the
// ACTIVE tab closes -- MRU first (the editor rule), the right neighbour
// when the closed tab left no recorded successor, then the left, then
// null once nothing remains.
describe('nextActiveAfterClose', () => {
  const tabs = [tabAt('k1', 'wf1'), tabAt('k2', 'wf2'), tabAt('k3', 'wf3')]

  it('activates the most-recently-used remaining tab (MRU hit)', () => {
    // Activation order A, B, C; closing C (the active tab) returns to B,
    // the one visited just before it -- not A (the first tab).
    expect(nextActiveAfterClose(tabs, ['k1', 'k2', 'k3'], 'k3')).toBe('k2')
  })

  it('falls back to the right neighbour when the closed tab has no recorded successor (MRU empty)', () => {
    expect(nextActiveAfterClose(tabs, [], 'k2')).toBe('k3')
  })

  it('falls back to the left neighbour when closing the last tab', () => {
    expect(nextActiveAfterClose(tabs, [], 'k3')).toBe('k2')
  })

  it('returns null when the closed tab was the only one open', () => {
    expect(nextActiveAfterClose([tabAt('k1', 'wf1')], ['k1'], 'k1')).toBeNull()
  })

  it('skips a recent entry that IS the closed key, using the next-most-recent survivor', () => {
    // recent's own last entry is the tab being closed (it was activated
    // right before this close) -- the survivor is the one before that.
    expect(nextActiveAfterClose(tabs, ['k1', 'k3', 'k2'], 'k2')).toBe('k3')
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
