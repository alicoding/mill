import { describe, expect, it } from 'vitest'
import { workflowPayloadHint } from './triggerPayload'
import type { Workflow } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'

const wf = (nodeTypeID: string) =>
  ({ Nodes: [{ ID: 't', Kind: 'trigger', NodeTypeID: nodeTypeID, Config: {}, Position: { X: 0, Y: 0 } }] }) as unknown as Pick<Workflow, 'Nodes'>

describe('workflowPayloadHint', () => {
  it('returns the file-path hint for a filesystem-watch trigger', () => {
    expect(workflowPayloadHint(wf('trigger-filesystem-watch'))).toContain('file')
  })

  it('returns null for triggers with no event payload', () => {
    expect(workflowPayloadHint(wf('trigger-manual'))).toBeNull()
    expect(workflowPayloadHint(wf('trigger-schedule'))).toBeNull()
  })

  it('returns null for a missing workflow or no trigger node', () => {
    expect(workflowPayloadHint(null)).toBeNull()
    expect(workflowPayloadHint({ Nodes: [] } as unknown as Pick<Workflow, 'Nodes'>)).toBeNull()
  })
})
