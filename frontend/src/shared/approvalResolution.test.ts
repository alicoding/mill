import { describe, expect, it } from 'vitest'
import { resolveErrorKey } from './approvalResolution'

// A refused decision reaches the user as copy, never a console line --
// the reported bug was a button that looked dead because the refusal
// was swallowed.
describe('resolveErrorKey', () => {
  it('maps run-not-waiting to the no-longer-waiting copy', () => {
    expect(resolveErrorKey(new Error('executionsvc: run-not-waiting: run abc is not waiting on a decision')))
      .toBe('resolveError.notWaiting')
  })

  it('maps run-recovering to the try-again copy', () => {
    expect(resolveErrorKey(new Error('executionsvc: run-recovering: run abc is being picked back up')))
      .toBe('resolveError.recovering')
  })

  it('falls back to the generic copy for anything else', () => {
    expect(resolveErrorKey(new Error('connection lost'))).toBe('resolveError.generic')
    expect(resolveErrorKey('some string')).toBe('resolveError.generic')
  })
})
