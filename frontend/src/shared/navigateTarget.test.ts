import { describe, expect, it } from 'vitest'
import { parseNavigateTarget, workflowTarget } from './navigateTarget'

describe('parseNavigateTarget', () => {
  it('maps the page targets to views', () => {
    expect(parseNavigateTarget('settings')).toEqual({ view: { kind: 'settings' } })
    expect(parseNavigateTarget('review')).toEqual({ view: { kind: 'review' } })
    expect(parseNavigateTarget('configure:lists')).toEqual({ view: { kind: 'configure', tab: 'lists' } })
    expect(parseNavigateTarget('atlas:card-1')).toEqual({ view: { kind: 'atlas', cardID: 'card-1' } })
  })

  it('opens a workflow read-only, with an exact or latest run when asked', () => {
    expect(parseNavigateTarget('workflow:wf-1')).toEqual({ workTab: { kind: 'workflow-edit', workflowId: 'wf-1', mode: 'view' } })
    expect(parseNavigateTarget('workflow:wf-1:run:r-9')).toEqual({ workTab: { kind: 'workflow-edit', workflowId: 'wf-1', mode: 'view', runId: 'r-9' } })
    expect(parseNavigateTarget('workflow:wf-1:run:latest')).toEqual({ workTab: { kind: 'workflow-edit', workflowId: 'wf-1', mode: 'view', runId: 'latest' } })
  })

  it('rejects an empty workflow id and unknown targets', () => {
    expect(parseNavigateTarget('workflow:')).toBeNull()
    expect(parseNavigateTarget('nowhere')).toBeNull()
  })

  it('round-trips through workflowTarget', () => {
    expect(parseNavigateTarget(workflowTarget('wf-1'))).toEqual({ workTab: { kind: 'workflow-edit', workflowId: 'wf-1', mode: 'view' } })
    expect(parseNavigateTarget(workflowTarget('wf-1', 'r-2'))).toEqual({ workTab: { kind: 'workflow-edit', workflowId: 'wf-1', mode: 'view', runId: 'r-2' } })
  })
})
