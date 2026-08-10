import { describe, it, expect } from 'vitest'
import { describeCron } from './cronDescribe'

// describeCron backs both SchedulePreview.tsx and the trigger-aware
// Workflows-list row label (docs/goals/0006-trigger-aware-workflows-list.md)
// -- covering the three branches directly (.claude/rules/testing.md)
// rather than only through whichever component happens to render it.
describe('describeCron', () => {
  it('describes a standard 5-field expression', () => {
    const result = describeCron('0 9 * * 1-5')
    expect(result.kind).toBe('described')
    if (result.kind === 'described') {
      expect(result.text).toMatch(/9:00 AM/i)
    }
  })

  it('treats an @-shortcut as its own kind, not a parse attempt', () => {
    expect(describeCron('@daily')).toEqual({ kind: 'shortcut', value: '@daily' })
  })

  it('flags an unparsable expression as invalid rather than throwing', () => {
    expect(describeCron('not a cron')).toEqual({ kind: 'invalid' })
  })

  it('trims surrounding whitespace before classifying', () => {
    expect(describeCron('  @hourly  ')).toEqual({ kind: 'shortcut', value: '@hourly' })
  })
})
