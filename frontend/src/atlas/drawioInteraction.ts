// In-frame pan/zoom for the vendored drawio viewer (goal 0340). Every
// movement here goes through the viewer's OWN graph API -- mxGraphView
// .setTranslate / .scaleAndTranslate, mxGraph.fit, mxPanningHandler --
// never a DOM scroll hack, because the viewer owns its host's children
// and its own inline sizing; a second, competing geometry would drift
// from the one the toolbar's zoom buttons already move.
//
// Why the frame needs this at all: GraphViewer.init leaves
// `resizeContainer = true` (its addSizeHandler), so the viewer GROWS
// its host to the full drawing height and calls setPanning(false).
// Inside a fixed board-object box that produces a drawing taller than
// its frame with no way to reach the rest of it. attachDrawioInteraction
// converts the host into a fixed viewport the drawing moves inside.

// The structural slice of the vendored mxGraph this module drives.
// Named against the vendored file's own prototypes (viewer.min.js:
// mxGraphView.prototype.setTranslate @611146, .scaleAndTranslate
// @610377, mxGraph.prototype.fit @655589, .getGraphBounds @699268,
// .setPanning @725619, .sizeDidChange, mxPanningHandler.prototype
// .isForcePanningEvent @797432).
export interface DrawioGraphView {
  scale: number
  translate: { x: number; y: number }
  setTranslate: (x: number, y: number) => void
  scaleAndTranslate: (scale: number, x: number, y: number) => void
}

// The one mxMouseEvent member this module reads. mxPanningHandler hands
// its force-panning predicate an mxMouseEvent, whose getEvent() returns
// the native event underneath.
export interface DrawioMouseEvent {
  getEvent: () => MouseEvent
}

export interface DrawioPanningHandler {
  panningEnabled: boolean
  useLeftButtonForPanning: boolean
  isForcePanningEvent: (me: DrawioMouseEvent) => boolean
}

export interface DrawioRect {
  x: number
  y: number
  width: number
  height: number
}

export interface DrawioGraph {
  view: DrawioGraphView
  panningHandler: DrawioPanningHandler
  container: HTMLElement
  resizeContainer: boolean
  maxFitScale: number | null
  getGraphBounds: () => DrawioRect
  fit: () => number
  setPanning: (enabled: boolean) => void
  sizeDidChange: () => void
}

export interface DrawioViewport {
  scale: number
  tx: number
  ty: number
}

// mxGraph.prototype.zoomFactor (viewer.min.js @642059) -- the exact
// step the toolbar's own Zoom In/Out buttons take, reused so a wheel
// notch and a button press land on the same scale ladder.
export const DRAWIO_ZOOM_FACTOR = 1.2

// One standard wheel notch's deltaY in CSS pixels. A full notch is one
// toolbar step; a trackpad pinch's many small deltas scale down
// proportionally instead of jumping a full step each event.
export const DRAWIO_WHEEL_NOTCH = 100

// Scale floor/ceiling. The viewer itself imposes none, and an unclamped
// exponential wheel can reach a scale where the SVG's own min-width/
// min-height (mxGraph.sizeDidChange) exceeds what a browser will lay
// out.
export const DRAWIO_MIN_SCALE = 0.1
export const DRAWIO_MAX_SCALE = 8

// A drawing never "exceeds" its frame by a subpixel: mxGraph rounds its
// own container sizing up (Math.ceil in sizeDidChange), so a diagram
// that fits exactly still reports one stray pixel without this.
export const DRAWIO_OVERFLOW_TOLERANCE = 2

// panBy -- a wheel/trackpad delta in SCREEN pixels applied to the
// view's translate, which mxGraph stores in UNSCALED graph units
// (mxGraphView.getState multiplies by scale after translating), so the
// delta divides by the current scale. Sign is inverted: scrolling down
// moves the drawing up.
export function panBy(view: DrawioViewport, deltaX: number, deltaY: number): { tx: number; ty: number } {
  return {
    tx: view.tx - deltaX / view.scale,
    ty: view.ty - deltaY / view.scale,
  }
}

// zoomAbout -- a new scale plus the translate that keeps the graph
// point currently under (cx, cy) under it afterwards. cx/cy are
// container-relative pixels: the viewer's SVG shares the host's own
// origin, so a point's screen position is (graphPoint + translate) *
// scale, and holding graphPoint fixed gives the translate below.
// Clamping happens BEFORE the translate is derived, so a clamped zoom
// still keeps the cursor anchored rather than drifting.
export function zoomAbout(view: DrawioViewport, cx: number, cy: number, deltaY: number): DrawioViewport {
  const raw = view.scale * Math.pow(DRAWIO_ZOOM_FACTOR, -deltaY / DRAWIO_WHEEL_NOTCH)
  const scale = Math.min(DRAWIO_MAX_SCALE, Math.max(DRAWIO_MIN_SCALE, raw))
  return {
    scale,
    tx: cx / scale - cx / view.scale + view.tx,
    ty: cy / scale - cy / view.scale + view.ty,
  }
}

// exceedsFrame -- does the drawing, at its current scale, need more
// room than the frame gives it. mxGraph.getGraphBounds already returns
// SCALED bounds, so no second multiplication belongs here; only the
// extent matters, never where the translate currently puts it (panning
// moves a drawing, it never resizes one).
export function exceedsFrame(bounds: { width: number; height: number }, frame: { width: number; height: number }): boolean {
  return bounds.width > frame.width + DRAWIO_OVERFLOW_TOLERANCE
    || bounds.height > frame.height + DRAWIO_OVERFLOW_TOLERANCE
}

// The signal the frame's "Fit" chip renders from: whether the drawing
// currently overflows, and the action that fits it. Supplied by the
// content, rendered by AtlasBoardObjectNode -- the chip lives on the
// shared chrome band, which no face owns.
export type DrawioOverflowReporter = (exceeds: boolean, fit: () => void) => void

// Paging, through the viewer's OWN page API rather than a second
// reader of the .drawio XML (viewer.min.js's GraphViewer closure):
//   this.selectPage = function(J){ ... this.currentPage = mxUtils.mod(J,
//     this.diagrams.length); ... this.updateGraphXml(
//     Editor.parseDiagramNode(this.diagrams[this.currentPage])) }
//   this.selectPageById = function(J){ J = this.getIndexById(J);
//     var ea = 0 <= J; ea && this.selectPage(J); return ea }
// `diagrams` is the file's own <diagram> node list, `currentPage` the
// index showing, and selectPage takes an INDEX -- the same two calls
// the viewer's own prev/next buttons make (`this.selectPage(
// this.currentPage - 1)` / `+ 1`). selectPage wraps modulo, so an
// out-of-range index is safe; the chrome that offers paging is what
// stops at the ends.
export interface DrawioPagingViewer {
  diagrams?: unknown[]
  currentPage?: number
  selectPage?: (index: number) => void
}

// What the chrome renders from: where the face is in the file, how many
// pages there are, and the action that moves it. The same reporter
// shape overflow already uses -- only the face can know these, only the
// frame owns the band they render on.
export interface DrawioPageCursor {
  index: number
  count: number
  select: (index: number) => void
}
export type DrawioPagerReporter = (cursor: DrawioPageCursor) => void

// pageCursorOf reads the cursor out of a viewer instance. Pure against
// the instance shape, so the reporting rule is unit-testable without a
// vendored viewer.
export function pageCursorOf(viewer: DrawioPagingViewer, select: (index: number) => void): DrawioPageCursor {
  return { index: viewer.currentPage ?? 0, count: viewer.diagrams?.length ?? 0, select }
}

// attachDrawioPaging reports the viewer's page cursor to the frame, and
// again after every page change it makes. `initialPage` restores where
// this object was left earlier in the session -- applied only when the
// file still has that page, so a file that lost pages on disk opens at
// its first one rather than at nothing.
export function attachDrawioPaging(viewer: DrawioPagingViewer, report: DrawioPagerReporter, initialPage?: number): void {
  const count = viewer.diagrams?.length ?? 0
  const select = (index: number): void => {
    if (index < 0 || index >= count || !viewer.selectPage) return
    viewer.selectPage(index)
    report(pageCursorOf(viewer, select))
  }
  if (initialPage !== undefined && initialPage > 0 && initialPage < count) viewer.selectPage?.(initialPage)
  report(pageCursorOf(viewer, select))
}

// isPrimaryDrag -- mxPanningHandler's forcePanningHandler starts a pan
// on ANY mouse-down it accepts, WITHOUT consulting isPanningTrigger's
// own left-button check (viewer.min.js, the mxPanningHandler
// constructor's FIRE_MOUSE_EVENT listener). A predicate that answered
// "yes" unconditionally would therefore pan on a right-click and eat
// the board's context menu; macOS's ctrl-click secondary gesture is
// excluded for the same reason.
export function isPrimaryDrag(evt: MouseEvent): boolean {
  return evt.button === 0 && !evt.ctrlKey
}

// attachDrawioInteraction -- turns an initialized viewer's host into a
// fixed viewport its drawing pans and zooms inside, and returns the
// detach. Called from inside GraphViewer.createViewerForElement's own
// callback, so `graph` is fully built by this point.
export function attachDrawioInteraction(graph: DrawioGraph, onOverflow?: DrawioOverflowReporter): () => void {
  const host = graph.container

  // 1. A fixed viewport. The viewer's addSizeHandler set resizeContainer
  //    and wrote an inline width/height sized to the whole drawing;
  //    clearing both hands sizing back to the frame's own CSS box, and
  //    sizeDidChange re-runs the SVG's own min-width/min-height pass
  //    against the new state without resizing the host again.
  graph.resizeContainer = false
  host.style.width = ''
  host.style.height = ''
  graph.sizeDidChange()

  // 2. Drag-to-pan, through the viewer's own panning handler rather
  //    than a hand-rolled pointer-capture loop. The viewer already
  //    configured useLeftButtonForPanning/ignoreCell/usePopupTrigger
  //    and then disabled panning outright plus gated force-panning on
  //    an `overflow == "auto"` host it never actually leaves in that
  //    state; both gates are lifted here.
  graph.setPanning(true)
  graph.panningHandler.useLeftButtonForPanning = true
  graph.panningHandler.isForcePanningEvent = (me) => isPrimaryDrag(me.getEvent())

  // 3. Fit never scales a drawing UP past 1:1 -- GraphViewer's own
  //    fitGraph pins maxFitScale the same way from allow-zoom-in
  //    (default off), so a small drawing stays its own size instead of
  //    ballooning to fill the frame.
  function fit(): void {
    graph.maxFitScale = 1
    graph.fit()
    graph.maxFitScale = null
    report()
  }

  function report(): void {
    if (!onOverflow) return
    const bounds = graph.getGraphBounds()
    onOverflow(exceedsFrame(bounds, { width: host.clientWidth, height: host.clientHeight }), fit)
  }

  // 4. Wheel: plain scroll/two-finger pans both axes, ctrl/⌘ (which is
  //    also what a browser synthesizes for a trackpad pinch) zooms
  //    about the pointer. preventDefault because the page must not
  //    scroll under a gesture the frame has claimed; the node's own
  //    `nowheel` class already keeps the board still.
  const onWheel = (event: WheelEvent) => {
    event.preventDefault()
    const view: DrawioViewport = { scale: graph.view.scale, tx: graph.view.translate.x, ty: graph.view.translate.y }
    if (event.ctrlKey || event.metaKey) {
      const rect = host.getBoundingClientRect()
      const next = zoomAbout(view, event.clientX - rect.left, event.clientY - rect.top, event.deltaY)
      graph.view.scaleAndTranslate(next.scale, next.tx, next.ty)
      report()
      return
    }
    const next = panBy(view, event.deltaX, event.deltaY)
    graph.view.setTranslate(next.tx, next.ty)
  }
  host.addEventListener('wheel', onWheel, { passive: false })

  // 5. The frame changing size changes what fits in it, so every
  //    delivery re-reports the overflow. It deliberately does NOT
  //    refit: a mount settles across several deliveries as the box's
  //    own measured size resolves, and fitting on those would silently
  //    shrink every drawing the moment it appeared. Refitting is the
  //    frame's own call, made when the USER finishes a resize
  //    (AtlasBoardObjectNode's NodeResizer onResizeEnd), through the
  //    fit handed back by this reporter.
  const observer = new ResizeObserver(() => { report() })
  observer.observe(host)

  return () => {
    host.removeEventListener('wheel', onWheel)
    observer.disconnect()
  }
}
