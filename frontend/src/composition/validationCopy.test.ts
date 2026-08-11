import { describe, expect, it } from 'vitest'
import { formatIssuesForCopy } from './validationCopy'
import { Severity, type Issue } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'

const issue = (partial: Partial<Issue>): Issue => ({ Severity: Severity.SeverityError, Message: '', NodeID: '', EdgeID: '', ...partial } as Issue)

describe('formatIssuesForCopy', () => {
  it('names the workflow, counts, and each issue with its node/edge id', () => {
    const out = formatIssuesForCopy('Load sample HTML', [
      issue({ Severity: Severity.SeverityError, NodeID: 'n1', Message: 'a workflow must start with a Trigger step' }),
      issue({ Severity: Severity.SeverityWarning, EdgeID: 'e7', Message: 'dangling edge' }),
    ])
    expect(out).toBe(
      'Mill workflow "Load sample HTML" — validation issues (1 error · 1 warning):\n' +
      '- [error] node n1: a workflow must start with a Trigger step\n' +
      '- [warning] edge e7: dangling edge',
    )
  })

  it('omits the location fragment when an issue has no node or edge id', () => {
    const out = formatIssuesForCopy('W', [issue({ Severity: Severity.SeverityError, Message: 'graph has no nodes' })])
    expect(out).toContain('- [error]: graph has no nodes')
  })

  it('pluralizes counts', () => {
    const out = formatIssuesForCopy('W', [
      issue({ Severity: Severity.SeverityWarning, Message: 'a' }),
      issue({ Severity: Severity.SeverityWarning, Message: 'b' }),
    ])
    expect(out).toContain('(2 warnings)')
  })
})
