import { getStroke } from 'perfect-freehand'

export interface PencilPoint { x: number; y: number }

export interface PencilStrokeSvg {
  svg: string
  // The stroke's own bounding-box origin, in the SAME coordinate space
  // the input points were given in -- the caller converts this one
  // point through its own screenToFlowPosition to place the resulting
  // card exactly where the stroke was drawn, matching the native
  // file-drop door's own drop-point placement (useAtlasNativeFileDrop.ts).
  originX: number
  originY: number
}

// simulatePressure -- a mouse/trackpad reports no real analog pressure
// (PointerEvent.pressure is 0 or a flat 0.5), so perfect-freehand
// simulates width variation from drawing VELOCITY instead, matching
// how tldraw/Excalidraw render a mouse-drawn stroke.
const STROKE_OPTIONS = { thinning: 0.6, smoothing: 0.5, streamline: 0.5, simulatePressure: true } as const

// The perfect-freehand -> SVG path conversion: a quadratic curve
// through each outline edge's own midpoint smooths the raw polygon
// getStroke() returns into a continuous stroke silhouette, closing
// back to the first point.
export function outlinePathData(outline: number[][]): string {
  if (outline.length === 0) return ''
  const start = outline[0]
  const d = outline.reduce<(string | number)[]>((acc, [x0, y0], i, arr) => {
    const [x1, y1] = arr[(i + 1) % arr.length]
    acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2)
    return acc
  }, ['M', start[0], start[1], 'Q'])
  d.push('Z')
  return d.join(' ')
}

// The in-progress drag's own live preview (AtlasPencilLivePreview.tsx):
// the SAME outline math as the final artifact below, but left in the
// caller's own coordinate space (no bbox translation) since the
// preview overlay already spans the whole wrapper 1:1.
export function livePreviewPathData(points: PencilPoint[], size: number): string {
  if (points.length < 2) return ''
  const outline = getStroke(points.map((p) => [p.x, p.y]), { ...STROKE_OPTIONS, size })
  return outlinePathData(outline)
}

// Builds a self-contained SVG mirror file from a completed stroke's
// raw points -- the pencil tool's own commit() lands this exact string
// through SaveImageBytes/CreateCardFromFileDrop, the same mirror door
// the image tool already uses (goal 0169 slice 2), so the drawn
// colour/size bake into the file itself: document data, never the
// ephemeral style cache (atlasPencilStyleStore.ts). Returns null for a
// degenerate input (fewer than two points, or a zero-length stroke) --
// the caller treats that as a stray click, not a draw.
export function buildPencilStrokeSvg(points: PencilPoint[], color: string, size: number): PencilStrokeSvg | null {
  if (points.length < 2) return null
  const outline = getStroke(points.map((p) => [p.x, p.y]), { ...STROKE_OPTIONS, size })
  if (outline.length === 0) return null
  const xs = outline.map((p) => p[0])
  const ys = outline.map((p) => p[1])
  const originX = Math.min(...xs)
  const originY = Math.min(...ys)
  const width = Math.max(1, Math.max(...xs) - originX)
  const height = Math.max(1, Math.max(...ys) - originY)
  const normalized = outline.map(([x, y]) => [x - originX, y - originY])
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><path d="${outlinePathData(normalized)}" fill="${color}"/></svg>`
  return { svg, originX, originY }
}

// Same UTF-8-safe byte-then-btoa idiom fileToBase64 (atlasTools.ts)
// and DataStewardshipSection.tsx's own fileToBase64 already use for
// arbitrary bytes, applied to a plain string via TextEncoder rather
// than File.arrayBuffer() -- kept as one small chunked loop (not the
// deprecated escape/unescape round trip) so a non-ASCII colour name
// never mis-encodes.
export function svgToBase64(svg: string): string {
  const bytes = new TextEncoder().encode(svg)
  const chunkSize = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}
