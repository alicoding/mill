import { describe, it, expect } from 'vitest'
import cronstrue from 'cronstrue'

// The library contract SchedulePreview relies on (goal 0001): standard
// cron gets a human description; an invalid expression throws (caught
// in the component). Guards the adoption, per .claude/rules/testing.md.
describe('cron description', () => {
  it('describes a standard 5-field expression', () => {
    expect(cronstrue.toString('* * * * *', { verbose: true })).toMatch(/every minute/i)
    expect(cronstrue.toString('0 9 * * 1-5', { verbose: true })).toMatch(/9:00 AM/i)
  })
  it('throws on an invalid expression when asked to', () => {
    expect(() => cronstrue.toString('not a cron', { throwExceptionOnParseError: true })).toThrow()
  })
})
