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
//   selected -- the face receives pointer events and keys; the chrome
//               band drags the object; a wheel stays local only where
//               something under it can actually consume it (see
//               wheelStaysLocal).
//   editing  -- as selected, plus the face has an editor open, so the
//               frame keeps the board's own keymap out of the way.

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

// The three derived opt-outs, named rather than inlined so the frame
// reads as the contract and a test can pin each one.

// The node box carries the canvas kit's `nowheel` class exactly while
// the face is live: the kit resolves that class by event-target
// ancestry, and a wheel can land on node chrome (the drag band, the
// object's own padding) that sits outside the face itself.
export function boxOptsOutOfCanvasWheel(state: AtlasActivation): boolean {
  return state !== 'idle'
}

// The content box carries `nodrag`/`nopan` on the same window: while
// the face owns the pointer, a drag inside it must reach only the face
// -- the chrome band stays the object's drag surface. A vendored
// viewer's own pan calls preventDefault WITHOUT stopping propagation,
// so without this one drag both pans the drawing and moves the object.
export function contentOptsOutOfCanvasDrag(state: AtlasActivation): boolean {
  return state !== 'idle'
}

// The click shield: transparent, over the content, present exactly
// while an interactive face is idle. Object first, content second --
// the first click always selects the object, so a bare click can never
// land straight in a cell or inside an embedded viewer.
export function shieldUp(input: AtlasInputMode, state: AtlasActivation, preview: boolean): boolean {
  return input === 'interactive' && state === 'idle' && !preview
}

// ScrollBox -- what wheelStaysLocal needs to know about one element on
// the wheel target's ancestor chain. Read off the DOM by scrollChainTo
// below; a plain record here so the rule itself is testable without a
// layout engine (jsdom reports every scroll metric as 0).
export interface ScrollBox {
  scrollWidth: number
  clientWidth: number
  scrollHeight: number
  clientHeight: number
  overflowX: string
  overflowY: string
}

// A REAL scroll container: it declares scrolling on an axis AND
// actually overflows on one. A declared `overflow: auto` that fits its
// content scrolls nothing, so a wheel over it belongs to the canvas.
export function isScrollContainer(box: ScrollBox): boolean {
  const scrolls = (value: string) => value === 'auto' || value === 'scroll'
  if (!scrolls(box.overflowX) && !scrolls(box.overflowY)) return false
  return box.scrollHeight > box.clientHeight || box.scrollWidth > box.clientWidth
}

// wheelStaysLocal -- the routing rule. A wheel over a live face stays
// with the face when something under the pointer can consume it:
// either the face's own handler already claimed it (an embedded engine
// pans/zooms on wheel and calls preventDefault), or a real scroll
// container sits on the target's ancestor chain up to the node box.
// Otherwise the wheel is over inert chrome and belongs to the canvas.
// `consumed` is not in tldraw's own scroll-container rule, which only
// ever meets plain HTML: without it a wheel over a vendored in-page
// pan/zoom engine would BOTH pan the drawing and pan the board, since
// such an engine consumes the gesture without ever being a DOM
// scroller.
export function wheelStaysLocal(consumed: boolean, chain: readonly ScrollBox[]): boolean {
  return consumed || chain.some(isScrollContainer)
}

// scrollChainTo reads the ancestor chain from the wheel's target up to
// (and including) the node box. The DOM adapter for the rule above --
// the one impure function here, kept beside it so the frame has a
// single call rather than its own traversal.
export function scrollChainTo(target: Element | null, box: Element): ScrollBox[] {
  const chain: ScrollBox[] = []
  for (let el = target; el instanceof Element; el = el.parentElement) {
    const style = getComputedStyle(el)
    chain.push({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      overflowX: style.overflowX,
      overflowY: style.overflowY,
    })
    if (el === box) break
  }
  return chain
}
