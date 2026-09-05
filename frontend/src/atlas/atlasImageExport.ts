import { domToBlob } from 'modern-screenshot'
import { getViewportForBounds, type Rect } from '@xyflow/react'

// Rasterizing the board (docs/goals/0201): the picture side of "copy or
// export what I'm looking at", kept out of any component so the two
// parts that can actually be wrong -- what the capture EXCLUDES, and
// what box it captures -- are plain functions with unit tests.
//
// modern-screenshot, not html-to-image: React Flow's own
// download-image example pins html-to-image at 1.11.11 because later
// releases regress, and an unmaintained pin is not a dependency this
// repo adopts. modern-screenshot is the maintained fork of the same
// foreignObject-SVG technique with the same option names, so the
// example's shape carries over unchanged.
//
// The clone reads COMPUTED styles off the live elements, which is why
// the selection ring is suppressed with a CSS rule keyed off
// CAPTURING_ATTRIBUTE (AtlasBoard.module.css) rather than by removing
// the chrome elements: a ring is a box-shadow on the node itself, and
// dropping the node would drop the card with it.

// The breathing room around the captured content, in board units.
// Fixed: a padding knob is a setting nobody returns to, and every tool
// in this class ships one number.
export const IMAGE_EXPORT_PADDING = 32

// What "Copy as image" always uses: retina-sharp, opaque, no dialog.
export const IMAGE_COPY_SCALE = 2

// The zoom clamp handed to getViewportForBounds. The capture box is
// derived FROM the bounds, so the fit is always 1 and these only bound
// a degenerate box (a single zero-size node).
const MIN_CAPTURE_ZOOM = 0.1
const MAX_CAPTURE_ZOOM = 4

// The board's viewport carries this while a capture is in flight; the
// CSS rules keyed off it hide selection chrome from the rendered
// image. On the VIEWPORT specifically, since that is both the capture
// root and the one ancestor every node and edge is guaranteed to sit
// under.
export const CAPTURING_ATTRIBUTE = 'data-capturing'

// An affordance that exists only to be clicked -- never to be looked
// at -- carries this attribute to drop out of the exported picture
// (goal 0201 follow-up: the note card's own "Zoom into" chip is the
// first). CSS on the viewport (AtlasBoard.module.css, beside the ring/
// band rules) hides anything carrying it for the capture's duration
// only, the same `data-capturing`-keyed pattern CAPTURING_ATTRIBUTE
// itself uses -- so the next excluded affordance costs one attribute,
// never a new selector.
export const CAPTURE_EXCLUDE_ATTRIBUTE = 'data-capture-exclude'

// A frame-backed noun's iframe body is dropped from the capture
// outright (shouldCapture's own IFRAME rule below, since a second
// document's markup can't be rasterized) -- these two attributes mark
// its own root as a placeholder and name what to show in its place.
// CSS on the viewport renders CAPTURE_LABEL_ATTRIBUTE's value only for
// the capture's duration, so the next iframe-backed noun needs only
// these two attributes, no new markup of its own.
export const CAPTURE_PLACEHOLDER_ATTRIBUTE = 'data-capture-placeholder'
export const CAPTURE_LABEL_ATTRIBUTE = 'data-capture-label'

// What a frame-backed noun's placeholder names itself: its own title
// beside its kind, the same " · " join AtlasContentsView already uses
// for a kind label beside a title.
export function capturePlaceholderLabel(title: string, kindLabel: string): string {
  return `${title} · ${kindLabel}`
}

// Which nodes and edges the image is allowed to contain. `null` means
// "everything on the board" -- the no-selection case, which broadens
// rather than refusing.
export interface CaptureScope {
  nodeIDs: Set<string> | null
  edgeIDs: Set<string> | null
}

// Chrome that exists to be dragged, never to be looked at: connection
// handles, the resize frame, and React Flow's own multi-selection
// rectangle. Excluding an element excludes its children too, which is
// exactly right for all three.
const EXCLUDED_CLASSES = ['react-flow__handle', 'react-flow__resize-control', 'react-flow__nodesselection']

// The element shape the decision below actually reads. Structural
// rather than `Element` so the rule is testable without a DOM: this
// repo's Vitest runs in plain Node.
export interface CaptureCandidate {
  tagName: string
  classList: { contains(name: string): boolean }
  getAttribute(name: string): string | null
}

// Whether one element belongs in the picture. The ONE place the
// exclusion rules live.
export function shouldCapture(el: CaptureCandidate, scope: CaptureScope): boolean {
  // A frame is a SECOND document: the rasterizer inlines its markup
  // without its stylesheets, which does not resemble what the viewer
  // sees and pushes the surrounding layout around. The noun's own
  // frame and title stay in the picture; the frame's interior does
  // not (docs/goals/0201).
  if (el.tagName === 'IFRAME') return false
  for (const className of EXCLUDED_CLASSES) {
    if (el.classList.contains(className)) return false
  }
  const id = el.getAttribute('data-id')
  if (scope.nodeIDs && el.classList.contains('react-flow__node')) return id !== null && scope.nodeIDs.has(id)
  if (scope.edgeIDs && el.classList.contains('react-flow__edge')) return id !== null && scope.edgeIDs.has(id)
  return true
}

// Node.ELEMENT_NODE, spelled as its number: the DOM constant is not
// defined in the Node-hosted unit-test environment this module's own
// rules are proven in.
const ELEMENT_NODE = 1

export function captureFilter(scope: CaptureScope): (el: Node) => boolean {
  return (el: Node) => el.nodeType !== ELEMENT_NODE || shouldCapture(el as unknown as CaptureCandidate, scope)
}

// Every edge with BOTH ends in scope. An edge leaving the selection
// would be drawn as a line to nothing.
export function edgeIDsWithin(edges: readonly { id: string; source: string; target: string }[], nodeIDs: Set<string>): Set<string> {
  return new Set(edges.filter((e) => nodeIDs.has(e.source) && nodeIDs.has(e.target)).map((e) => e.id))
}

export function padBounds(bounds: Rect): Rect {
  return {
    x: bounds.x - IMAGE_EXPORT_PADDING,
    y: bounds.y - IMAGE_EXPORT_PADDING,
    width: bounds.width + IMAGE_EXPORT_PADDING * 2,
    height: bounds.height + IMAGE_EXPORT_PADDING * 2,
  }
}

const TRANSPARENT_COLORS = new Set(['transparent', 'rgba(0, 0, 0, 0)'])

// The first colour in an ancestry that actually paints something.
// React Flow's own panes are transparent by design, so the board's
// real ground is always some way up.
export function firstOpaqueColor(colors: readonly string[], fallback: string): string {
  for (const color of colors) {
    if (color && !TRANSPARENT_COLORS.has(color)) return color
  }
  return fallback
}

// The colour the image sits on: whatever the board itself renders,
// read from the live element rather than restated as a token here, so
// a theme change moves the export with it.
export function resolveBoardBackground(from: Element | null): string {
  const colors: string[] = []
  for (let el: Element | null = from; el; el = el.parentElement) {
    colors.push(getComputedStyle(el).backgroundColor)
  }
  const token = getComputedStyle(document.documentElement).getPropertyValue('--bgColor-default').trim()
  return firstOpaqueColor(colors, token || '#ffffff')
}

// Which of the four copy confirmations to show: WHAT was copied, and
// on a remote device, WHERE it landed. Server mode writes the
// DESKTOP's clipboard, never the browsing device's, so that is said
// rather than left to be discovered by a paste that produces nothing.
export function copiedNoticeKey(scoped: boolean, remote: boolean): string {
  if (remote) return scoped ? 'imageExport.copiedSelectionRemote' : 'imageExport.copiedBoardRemote'
  return scoped ? 'imageExport.copiedSelection' : 'imageExport.copiedBoard'
}

// A filename a filesystem will accept: the board's own name, with the
// separators no path may contain folded to spaces.
export function imageFilename(name: string): string {
  const cleaned = name.replace(/[/\\:]+/g, ' ').replace(/\s+/g, ' ').trim()
  return `${cleaned}.png`
}

export interface RasterizeInput {
  // The board's `.react-flow__viewport` -- the one element holding
  // every node and edge in board coordinates. Tagged with
  // CAPTURING_ATTRIBUTE for the duration, so the selection-chrome CSS
  // applies to the computed styles the clone copies.
  viewport: HTMLElement
  // Already padded (padBounds).
  bounds: Rect
  scope: CaptureScope
  scale: number
  // null renders a transparent PNG.
  backgroundColor: string | null
}

export async function rasterizeBoard({ viewport, bounds, scope, scale, backgroundColor }: RasterizeInput): Promise<Blob> {
  const width = Math.max(1, Math.round(bounds.width))
  const height = Math.max(1, Math.round(bounds.height))
  const transform = getViewportForBounds(bounds, width, height, MIN_CAPTURE_ZOOM, MAX_CAPTURE_ZOOM, 0)
  viewport.setAttribute(CAPTURING_ATTRIBUTE, 'true')
  try {
    return await domToBlob(viewport, {
      type: 'image/png',
      width,
      height,
      scale,
      backgroundColor,
      filter: captureFilter(scope),
      style: {
        width: `${width}px`,
        height: `${height}px`,
        transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.zoom})`,
      },
    })
  } finally {
    viewport.removeAttribute(CAPTURING_ATTRIBUTE)
  }
}
