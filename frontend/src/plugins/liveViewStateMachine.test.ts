import { describe, expect, it } from 'vitest'
// The mill-live-view plugin's own pure state machine lives beside its
// bundled entry page (internal/services/pluginsvc/builtin/mill-live-view/
// stateMachine.js), not under frontend/src: a plugin's view.js is a
// plain static asset with no bundler, so this test imports the SAME
// file view.js does (single source of truth), just reaching outside
// src/ to do it -- goal 0374's Vitest coverage of composing/sending/
// sent/error/undo-allowed.
import { createWriteState, nextWriteState, WRITE_STATES } from '../../../internal/services/pluginsvc/builtin/mill-live-view/stateMachine.js'

describe('mill-live-view write state machine', () => {
  it('starts Composing', () => {
    expect(createWriteState()).toEqual({ status: WRITE_STATES.COMPOSING, canUndo: false, error: '' })
  })

  it('Composing -> send -> Sending', () => {
    const next = nextWriteState(createWriteState(), { type: 'send' })
    expect(next.status).toBe(WRITE_STATES.SENDING)
  })

  it('Sending -> sent -> Sent, carrying canUndo', () => {
    const sending = nextWriteState(createWriteState(), { type: 'send' })
    const sentWithUndo = nextWriteState(sending, { type: 'sent', canUndo: true })
    expect(sentWithUndo).toEqual({ status: WRITE_STATES.SENT, canUndo: true, error: '' })

    const sentNoUndo = nextWriteState(sending, { type: 'sent', canUndo: false })
    expect(sentNoUndo.canUndo).toBe(false)
  })

  it('Sending -> error -> Error, carrying the message', () => {
    const sending = nextWriteState(createWriteState(), { type: 'send' })
    const errored = nextWriteState(sending, { type: 'error', message: "Couldn't send. Try again." })
    expect(errored).toEqual({ status: WRITE_STATES.ERROR, canUndo: false, error: "Couldn't send. Try again." })
  })

  it('Error -> retry -> back to a fresh Composing (the draft is the caller\'s own to keep, this only resets status)', () => {
    const sending = nextWriteState(createWriteState(), { type: 'send' })
    const errored = nextWriteState(sending, { type: 'error', message: 'x' })
    const retried = nextWriteState(errored, { type: 'retry' })
    expect(retried).toEqual(createWriteState())
  })

  it('Sent with canUndo -> undo -> Sending again', () => {
    const sending = nextWriteState(createWriteState(), { type: 'send' })
    const sent = nextWriteState(sending, { type: 'sent', canUndo: true })
    const undone = nextWriteState(sent, { type: 'undo' })
    expect(undone.status).toBe(WRITE_STATES.SENDING)
  })

  it('Sent with canUndo=false ignores undo (the honest "no fake undo" rule)', () => {
    const sending = nextWriteState(createWriteState(), { type: 'send' })
    const sent = nextWriteState(sending, { type: 'sent', canUndo: false })
    const attempted = nextWriteState(sent, { type: 'undo' })
    expect(attempted).toBe(sent)
  })

  it('an event the current status does not accept is a no-op, never a throw', () => {
    const composing = createWriteState()
    expect(nextWriteState(composing, { type: 'sent', canUndo: true })).toBe(composing)
    expect(nextWriteState(composing, { type: 'undo' })).toBe(composing)
    expect(nextWriteState(composing, { type: 'retry' })).toBe(composing)
  })

  it('Sent -> send -> a fresh Sending (the composer stays usable for a second reply, never one-shot)', () => {
    const sent = nextWriteState(nextWriteState(createWriteState(), { type: 'send' }), { type: 'sent', canUndo: false })
    expect(nextWriteState(sent, { type: 'send' })).toEqual({ status: WRITE_STATES.SENDING, canUndo: false, error: '' })
  })

  it('Sending ignores a second send (never double-fires while already in flight)', () => {
    const sending = nextWriteState(createWriteState(), { type: 'send' })
    expect(nextWriteState(sending, { type: 'send' })).toBe(sending)
  })

  it('Sending -> cancel -> a fresh Composing (Cancel is not a failure)', () => {
    const sending = nextWriteState(createWriteState(), { type: 'send' })
    expect(nextWriteState(sending, { type: 'cancel' })).toEqual(createWriteState())
  })

  it('cancel outside Sending is a no-op', () => {
    const composing = createWriteState()
    expect(nextWriteState(composing, { type: 'cancel' })).toBe(composing)
  })

  it('reset always returns a fresh Composing state from anywhere', () => {
    const sending = nextWriteState(createWriteState(), { type: 'send' })
    expect(nextWriteState(sending, { type: 'reset' })).toEqual(createWriteState())
  })
})
