import { describe, expect, it } from 'vitest'
import { resolveActiveWorkflowId } from './useQuickPanelWorkflowActions'

describe('resolveActiveWorkflowId (goal 0294)', () => {
  it('uses the active workflow row while it is visible', () => {
    expect(resolveActiveWorkflowId('run:b', ['a', 'b', 'c'])).toBe('b')
  })
  it('falls back to the first visible row when the list has no active row, or a stale one', () => {
    expect(resolveActiveWorkflowId(null, ['a', 'b'])).toBe('a')
    expect(resolveActiveWorkflowId('run:zzz', ['a', 'b'])).toBe('a')
    expect(resolveActiveWorkflowId('cmd:update.check', ['a'])).toBe('a')
  })
  it('has no target when no workflow row is listed', () => {
    expect(resolveActiveWorkflowId('run:a', [])).toBeNull()
    expect(resolveActiveWorkflowId(null, [])).toBeNull()
  })
})
