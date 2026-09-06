// The ONE input contract between the canvas and the widget inside a
// board object (goal 0354). A noun declares one fact -- whether its
// face is `static` or `interactive` -- and every input opt-out the
// canvas kit needs is DERIVED here from that fact plus the object's own
// live state. No noun declares a wheel, drag or keyboard flag of its
// own; the per-noun clickShield/wheelContained pair this module
// replaced could disagree with each other (a face could shield without
// containing the wheel, and did).
//
// The three states, and who owns input in each:
//   idle     -- the canvas owns wheel, drag and keys; the face is inert
//               behind a click shield. Every `static` face is always
//               idle: the canvas owns it outright.
//   selected -- the face owns the wheel, the drag and the keys
//               outright; the chrome band, which is frame rather than
//               face, still drags the object and still pans the board.
//   editing  -- as selected, plus the face has an editor open, so the
//               frame keeps the board's own keymap out of the way.
//
// A live face owns the wheel UNCONDITIONALLY -- never by inferring,
// per event, whether something under the pointer could consume it. An
// embedded engine can pan on a wheel without ever being a DOM scroller
// and without preventing the default, so no inference can tell "the
// face used it" from "nothing used it"; a wheel that reaches both the
// engine and the board is the failure that rule produced (ADR-0046's
// two-plane amendment). The active-embed model the canvas tools
// converged on is the adopted one instead: while the embed is active
// it gets every wheel, and the canvas gets none until the user leaves.

export type AtlasInputMode = 'static' | 'interactive'
export type AtlasActivation = 'idle' | 'selected' | 'editing'

// activation resolves the state. A `static` face is idle for input
// purposes whatever the selection is -- selecting a shape or an image
// never hands it the wheel, which is exactly today's behaviour for
// those Kinds. A frame's inert preview tile passes nodeSelected false.
export function activation(nodeSelected: boolean, faceEditing: boolean, input: AtlasInputMode): AtlasActivation {
  if (input !== 'interactive' || !nodeSelected) return 'idle'
  return faceEditing ? 'editing' : 'selected'
}

// The one derived opt-out, named rather than inlined so the frame reads
// as the contract and a test can pin it. It rides the FACE wrapper, not
// the whole node box: the canvas kit resolves `nowheel`/`nodrag`/
// `nopan` by event-target ancestry (`event.target.closest('.nowheel')`
// in its own pan/zoom filter), so a class on the face leaves the chrome
// band -- a sibling of the face, not a descendant -- with the canvas,
// which is what keeps a live object from becoming a dead zone.
export function faceOwnsInput(state: AtlasActivation): boolean {
  return state !== 'idle'
}

// The click shield: transparent, over the content, present exactly
// while an interactive face is idle. Object first, content second --
// the first click always selects the object, so a bare click can never
// land straight in a cell or inside an embedded viewer.
export function shieldUp(input: AtlasInputMode, state: AtlasActivation, preview: boolean): boolean {
  return input === 'interactive' && state === 'idle' && !preview
}
