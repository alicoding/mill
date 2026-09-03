import { describe, expect, it } from 'vitest'
import { SUMMARY_KINDS, referenceOpenTarget } from './referenceTarget'

describe('referenceOpenTarget', () => {
  it('sends integrations and workflows to work tabs, Configure kinds to their tab, and unknown kinds nowhere', () => {
    expect(referenceOpenTarget('request', 'r1')).toEqual({ kind: 'work-tab', spec: { kind: 'request-edit', requestId: 'r1' } })
    expect(referenceOpenTarget('workflow', 'w1')).toEqual({ kind: 'work-tab', spec: { kind: 'workflow-edit', workflowId: 'w1', mode: 'view' } })
    expect(referenceOpenTarget('list', 'l1')).toEqual({ kind: 'configure', tab: 'lists' })
    expect(referenceOpenTarget('conversionprofile', 'c1')).toEqual({ kind: 'configure', tab: 'conversionprofiles' })
    expect(referenceOpenTarget('atlas-kind', 'k1')).toBeNull()
    expect(referenceOpenTarget('list', '')).toBeNull()
  })
  it('summarizes every Configure kind and the integration', () => {
    expect([...SUMMARY_KINDS].sort()).toEqual(['aiprovider', 'conversionprofile', 'decision', 'execenv', 'list', 'mcpserver', 'request'])
  })
})
