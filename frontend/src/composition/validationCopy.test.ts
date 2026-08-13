import { describe, expect, it } from 'vitest'
import { formatIssuesForCopy } from './validationCopy'
import { Severity, type Issue } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import composition from '../locales/en/composition.json'

const issue = (partial: Partial<Issue>): Issue => ({ Severity: Severity.SeverityError, Message: '', NodeID: '', EdgeID: '', ...partial } as Issue)

// A minimal stand-in for react-i18next's t() -- this is a pure-function
// unit test (docs/goals/0032-copy-management.md's migration), so it
// resolves the real English strings from composition.json's own nested
// keys and does the same {{var}} interpolation i18next performs,
// without pulling react-i18next's provider/hook machinery into a
// non-component test.
function t(key: string, vars: Record<string, unknown> = {}): string {
  const value = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], composition)
  if (typeof value !== 'string') throw new Error(`missing composition.json key: ${key}`)
  return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(vars[name] ?? ''))
}

describe('formatIssuesForCopy', () => {
  it('names the workflow, its id, counts, and each issue with its node/edge id', () => {
    const out = formatIssuesForCopy(t, 'Load sample HTML', 'load-sample-html-workflow', [
      issue({ Severity: Severity.SeverityError, NodeID: 'n1', Message: 'a workflow must start with a Trigger step' }),
      issue({ Severity: Severity.SeverityWarning, EdgeID: 'e7', Message: 'dangling edge' }),
    ])
    expect(out).toBe(
      'Mill workflow "Load sample HTML" (id: load-sample-html-workflow) — validation issues (1 error · 1 warning):\n' +
      '- [error] node n1: a workflow must start with a Trigger step\n' +
      '- [warning] edge e7: dangling edge',
    )
  })

  it('never double-prefixes when the message already carries its node location', () => {
    // ValidateGraph's real messages lead with "node <id>: " -- caught
    // from an actual paste that read "node X: node X: ..." (goal 0021).
    const out = formatIssuesForCopy(t, 'W', 'w-id', [
      issue({ NodeID: 'n1', Message: 'node n1: a workflow must start with a Trigger step' }),
    ])
    expect(out).toContain('- [error]: node n1: a workflow must start with a Trigger step')
    expect(out).not.toContain('node n1: node n1:')
  })

  it('omits the location fragment when an issue has no node or edge id', () => {
    const out = formatIssuesForCopy(t, 'W', 'w-id', [issue({ Message: 'graph has no nodes' })])
    expect(out).toContain('- [error]: graph has no nodes')
  })

  it('pluralizes counts', () => {
    const out = formatIssuesForCopy(t, 'W', 'w-id', [
      issue({ Severity: Severity.SeverityWarning, Message: 'a' }),
      issue({ Severity: Severity.SeverityWarning, Message: 'b' }),
    ])
    expect(out).toContain('(2 warnings)')
  })
})
