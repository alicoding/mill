import { describe, expect, it } from 'vitest'
import { groupIssuesByEdge } from './useDraftValidation'
import { Severity, type Issue } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'

const issue = (partial: Partial<Issue>): Issue => ({ Severity: Severity.SeverityError, Message: '', NodeID: '', EdgeID: '', ...partial } as Issue)

// The Rules panel's inline per-row validation (docs/goals/0173) keys
// off this map -- only error-severity, EdgeID-scoped issues belong in
// it, in the exact words ValidateGraph already produced.
describe('groupIssuesByEdge', () => {
  it('keeps only error-severity issues that name an edge', () => {
    const byEdge = groupIssuesByEdge([
      issue({ Severity: Severity.SeverityError, EdgeID: 'e1', Message: 'decision step "Branch", edge e1: unexpected token' }),
      issue({ Severity: Severity.SeverityWarning, EdgeID: 'e2', Message: 'a warning, never shown inline' }),
      issue({ Severity: Severity.SeverityError, NodeID: 'n1', Message: 'no EdgeID, a whole-node problem' }),
    ])
    expect(byEdge).toEqual({ e1: 'decision step "Branch", edge e1: unexpected token' })
  })

  it('returns an empty map for no issues', () => {
    expect(groupIssuesByEdge([])).toEqual({})
  })
})
