// The write flow's pure state machine (goal 0374): Composing -> Sending
// -> Sent -> Error (retry), with Undo offered only when the caller
// says the reverse transition is allowed. No I/O here -- view.js drives
// this with the real mill.call results; a Vitest spec exercises this
// file directly (frontend/src/plugins/__tests__/liveViewStateMachine.test.ts),
// so the transitions are pinned independent of the DOM/frame.

export const WRITE_STATES = Object.freeze({
  COMPOSING: 'composing',
  SENDING: 'sending',
  SENT: 'sent',
  ERROR: 'error',
})

// createWriteState is the initial state for a fresh compose surface.
export function createWriteState() {
  return { status: WRITE_STATES.COMPOSING, canUndo: false, error: '' }
}

// nextWriteState is the one pure transition function every event goes
// through. An event the current status doesn't accept returns the SAME
// state object unchanged -- a stale double-click or a duplicate reply
// is a no-op, never a thrown error.
export function nextWriteState(state, event) {
  switch (event.type) {
    case 'send':
      // Composing, a retried Error, or right after a previous Sent (a
      // second reply/transition starts its own fresh Composing ->
      // Sending run; goal 0374's composer stays usable after one send,
      // never a one-shot).
      if (state.status === WRITE_STATES.SENDING) return state
      return { status: WRITE_STATES.SENDING, canUndo: false, error: '' }
    case 'sent':
      if (state.status !== WRITE_STATES.SENDING) return state
      return { status: WRITE_STATES.SENT, canUndo: !!event.canUndo, error: '' }
    case 'error':
      if (state.status !== WRITE_STATES.SENDING) return state
      return { status: WRITE_STATES.ERROR, canUndo: false, error: event.message || '' }
    case 'retry':
      if (state.status !== WRITE_STATES.ERROR) return state
      return createWriteState()
    // cancel is the inline "ask" banner's own Cancel button (goal 0374
    // amendment 1): the user chose not to send, never a failure -- back
    // to a fresh Composing, draft text untouched (view.js owns that,
    // not this reducer).
    case 'cancel':
      if (state.status !== WRITE_STATES.SENDING) return state
      return createWriteState()
    case 'undo':
      if (state.status !== WRITE_STATES.SENT || !state.canUndo) return state
      return { status: WRITE_STATES.SENDING, canUndo: false, error: '' }
    case 'reset':
      return createWriteState()
    default:
      return state
  }
}
