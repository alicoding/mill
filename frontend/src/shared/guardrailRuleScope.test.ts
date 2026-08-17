import { describe, expect, it } from 'vitest'
import {
  resolveScopeChoice,
  ruleNameForScope,
  ruleScopeKind,
  ruleScopeSentence,
  type RuleScopeChoice,
} from './guardrailRuleScope'
import type { NodeType, Workflow } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import type { HTTPRequest } from '../../bindings/github.com/alicoding/mill/internal/domain/httprequest/models'

describe('ruleScopeKind', () => {
  it('classifies a workflow+node rule as step', () => {
    expect(ruleScopeKind({ NodeTypeID: '', RequestID: '', WorkflowID: 'wf1', NodeID: 'n1' })).toBe('step')
  })
  it('classifies a workflow-only rule as workflow', () => {
    expect(ruleScopeKind({ NodeTypeID: '', RequestID: '', WorkflowID: 'wf1', NodeID: '' })).toBe('workflow')
  })
  it('classifies a node-type-only rule as nodeType', () => {
    expect(ruleScopeKind({ NodeTypeID: 'integration-http', RequestID: '', WorkflowID: '', NodeID: '' })).toBe('nodeType')
  })
  it('classifies a request-only rule as request', () => {
    expect(ruleScopeKind({ NodeTypeID: '', RequestID: 'req1', WorkflowID: '', NodeID: '' })).toBe('request')
  })
  it('classifies a rule with no scope field as everywhere', () => {
    expect(ruleScopeKind({ NodeTypeID: '', RequestID: '', WorkflowID: '', NodeID: '' })).toBe('everywhere')
  })
})

const SCOPES: Record<'step' | 'workflow' | 'nodeType' | 'request', RuleScopeChoice> = {
  step: { kind: 'step', workflowLabel: 'Invoice sync', nodeTypeLabel: 'HTTP request' },
  workflow: { kind: 'workflow', workflowLabel: 'Invoice sync' },
  nodeType: { kind: 'nodeType', nodeTypeLabel: 'HTTP request' },
  request: { kind: 'request', requestLabel: 'Billing API' },
}

describe('ruleScopeSentence', () => {
  it('describes a step scope', () => {
    expect(ruleScopeSentence(SCOPES.step)).toBe('Only this step — HTTP request in Invoice sync')
  })
  it('describes a workflow scope', () => {
    expect(ruleScopeSentence(SCOPES.workflow)).toBe('Any step in Invoice sync')
  })
  it('describes a node-type scope', () => {
    expect(ruleScopeSentence(SCOPES.nodeType)).toBe('Every HTTP request step, in any workflow')
  })
  it('describes a request scope', () => {
    expect(ruleScopeSentence(SCOPES.request)).toBe('Any step calling Billing API')
  })
})

describe('resolveScopeChoice', () => {
  const workflows = [
    { ID: 'wf1', Label: 'Invoice sync', Nodes: [{ ID: 'n1', NodeTypeID: 'integration-http' }] },
  ] as unknown as Workflow[]
  const nodeTypes = [{ ID: 'integration-http', Label: 'HTTP request' }] as unknown as NodeType[]
  const requests = [{ ID: 'req1', Label: 'Billing API' }] as unknown as HTTPRequest[]

  it('resolves a step rule via the workflow node it names', () => {
    const got = resolveScopeChoice({ NodeTypeID: '', RequestID: '', WorkflowID: 'wf1', NodeID: 'n1' }, workflows, nodeTypes, requests)
    expect(got).toEqual({ kind: 'step', workflowLabel: 'Invoice sync', nodeTypeLabel: 'HTTP request' })
  })
  it('falls back to the raw node id when the step node was deleted', () => {
    const got = resolveScopeChoice({ NodeTypeID: '', RequestID: '', WorkflowID: 'wf1', NodeID: 'gone' }, workflows, nodeTypes, requests)
    expect(got).toEqual({ kind: 'step', workflowLabel: 'Invoice sync', nodeTypeLabel: 'gone' })
  })
  it('resolves a workflow-scoped rule', () => {
    const got = resolveScopeChoice({ NodeTypeID: '', RequestID: '', WorkflowID: 'wf1', NodeID: '' }, workflows, nodeTypes, requests)
    expect(got).toEqual({ kind: 'workflow', workflowLabel: 'Invoice sync' })
  })
  it('resolves a node-type-scoped rule', () => {
    const got = resolveScopeChoice({ NodeTypeID: 'integration-http', RequestID: '', WorkflowID: '', NodeID: '' }, workflows, nodeTypes, requests)
    expect(got).toEqual({ kind: 'nodeType', nodeTypeLabel: 'HTTP request' })
  })
  it('resolves a request-scoped rule', () => {
    const got = resolveScopeChoice({ NodeTypeID: '', RequestID: 'req1', WorkflowID: '', NodeID: '' }, workflows, nodeTypes, requests)
    expect(got).toEqual({ kind: 'request', requestLabel: 'Billing API' })
  })
  it('returns null for a scope-less rule', () => {
    expect(resolveScopeChoice({ NodeTypeID: '', RequestID: '', WorkflowID: '', NodeID: '' }, workflows, nodeTypes, requests)).toBeNull()
  })
})

describe('ruleNameForScope', () => {
  it.each([
    ['step', 'allow', 'Allow HTTP request in Invoice sync'],
    ['step', 'deny', 'Deny HTTP request in Invoice sync'],
    ['workflow', 'allow', 'Allow Invoice sync'],
    ['workflow', 'deny', 'Deny Invoice sync'],
    ['nodeType', 'allow', 'Allow HTTP request everywhere'],
    ['nodeType', 'deny', 'Deny HTTP request everywhere'],
    ['request', 'allow', 'Allow Billing API'],
    ['request', 'deny', 'Deny Billing API'],
  ] as const)('generates the name for %s scope, %s effect', (scopeKind, effect, want) => {
    expect(ruleNameForScope(effect, SCOPES[scopeKind])).toBe(want)
  })
})
