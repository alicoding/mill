import { describe, expect, it } from 'vitest'
import { resolveErrorKey } from './approvalResolution'

// A refused decision reaches the user as copy, never a console line --
// the reported bug was a button that looked dead because the refusal
// was swallowed.
// A bound-method rejection as the Wails runtime delivers it: the
// message is the Go chain, the marshalled code and sentence ride on
// `cause`.
function rejection(code: string, message: string, chain: string): Error {
  const err = new Error(chain)
  ;(err as { cause?: unknown }).cause = { code, message }
  return err
}

describe('resolveErrorKey', () => {
  it('maps run-not-waiting to the no-longer-waiting copy', () => {
    expect(resolveErrorKey(rejection('run-not-waiting', 'This run is no longer waiting.', 'run abc is not waiting on a decision')))
      .toBe('resolveError.notWaiting')
  })

  it('maps run-recovering to the try-again copy', () => {
    expect(resolveErrorKey(rejection('run-recovering', 'Mill is still picking this run back up. Try again in a moment.', 'run abc is being picked back up')))
      .toBe('resolveError.recovering')
  })

  it('falls back to the generic copy for anything else', () => {
    expect(resolveErrorKey(rejection('unexpected', 'Something went wrong. Try again.', 'connection lost'))).toBe('resolveError.generic')
    expect(resolveErrorKey(new Error('connection lost'))).toBe('resolveError.generic')
    expect(resolveErrorKey('some string')).toBe('resolveError.generic')
  })
})
