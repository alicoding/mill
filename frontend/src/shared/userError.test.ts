import { describe, expect, it } from 'vitest'
import { UNEXPECTED_CODE, messageFor, messageOf, userErrorFrom } from './userError'

// The chain a Go service used to hand straight to the pill.
const CHAIN = 'github: download: no release asset in test mode'

function wailsRejection(code: string, message: string, chain: string): Error {
  const err = new Error(chain)
  ;(err as { cause?: unknown }).cause = { code, message }
  return err
}

const COPY: Record<string, string> = {
  'common:errors.unexpected': 'Something went wrong. Try again.',
  'common:errors.run-not-waiting': 'This run is no longer waiting.',
}
const t = (key: string, options: { defaultValue: string }) => COPY[key] ?? options.defaultValue

describe('userErrorFrom', () => {
  it('reads the code and sentence off a bound-method rejection', () => {
    expect(userErrorFrom(wailsRejection('run-not-waiting', 'This run is no longer waiting.', 'run abc is not waiting')))
      .toEqual({ code: 'run-not-waiting', message: 'This run is no longer waiting.' })
  })

  it('reports no code for a plain Error, carrying its own text', () => {
    expect(userErrorFrom(new Error('boom'))).toEqual({ code: UNEXPECTED_CODE, message: 'boom' })
  })

  it('reports no code for a thrown string', () => {
    expect(userErrorFrom('boom')).toEqual({ code: UNEXPECTED_CODE, message: 'boom' })
  })

  it('ignores a cause that is not the marshalled pair', () => {
    const err = new Error('boom')
    ;(err as { cause?: unknown }).cause = new Error('inner')
    expect(userErrorFrom(err)).toEqual({ code: UNEXPECTED_CODE, message: 'boom' })
  })
})

describe('messageFor', () => {
  it('prefers the app wording for a code it has one for', () => {
    expect(messageFor(wailsRejection('run-not-waiting', 'A server sentence.', 'chain'), t))
      .toBe('This run is no longer waiting.')
  })

  it('falls back to the sentence the server sent for a code it has no wording for', () => {
    expect(messageFor(wailsRejection('auth-failed', "Mill couldn't confirm it's you.", 'chain'), t))
      .toBe("Mill couldn't confirm it's you.")
  })

  it('never shows the Go chain', () => {
    expect(messageFor(new Error(CHAIN), t)).toBe('Something went wrong. Try again.')
    expect(messageFor(wailsRejection(UNEXPECTED_CODE, 'Something went wrong. Try again.', CHAIN), t))
      .toBe('Something went wrong. Try again.')
  })
})

describe('messageOf', () => {
  it('answers for a pair a store already holds', () => {
    expect(messageOf({ code: 'run-not-waiting', message: 'A server sentence.' }, t)).toBe('This run is no longer waiting.')
  })

  it('answers generically for a coded failure with no sentence anywhere', () => {
    expect(messageOf({ code: 'nothing-knows-this', message: '' }, t)).toBe('Something went wrong. Try again.')
  })
})
