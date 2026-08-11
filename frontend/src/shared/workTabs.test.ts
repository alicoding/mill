import { describe, expect, it } from 'vitest'
import { shouldUpgradeToEdit, type WorkTab } from './workTabs'

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
