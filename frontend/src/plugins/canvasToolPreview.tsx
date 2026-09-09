import { useViewport } from '@xyflow/react'
import type { CanvasPreviewDecl, CanvasPreviewShape } from './sdk/canvasTools'
import { numbers, paintProps, previewShapes } from './canvasPreviewShapes'
import { liveDraftFor, useCanvasDrafts, type CanvasDraftRecord } from './canvasDrafts'

// The host-drawn preview (docs/goals/0380 Decision 1): a framed tool
// patches its draft's data, and Mill draws the declared shape from it
// on the SAME overlay slot every built-in drag tool's preview uses.
// The frame never touches the board's DOM, and the drawn thing and the
// committed thing come from one record, so they cannot disagree.
//
// Geometry is BOARD coordinates, drawn inside one group carrying the
// board's own viewport transform: the preview then sits exactly where
// the committed object will, tracks a pan mid-drag, and needs no
// per-point conversion on the way in.

function PreviewPrimitive({ shape, index }: { shape: CanvasPreviewShape; index: number }) {
  const props = { key: index, ...paintProps(shape) }
  if (shape.kind === 'path') return <path d={shape.geometry} {...props} />
  if (shape.kind === 'line') {
    const n = numbers(shape.geometry, 4)
    return n ? <line x1={n[0]} y1={n[1]} x2={n[2]} y2={n[3]} {...props} /> : null
  }
  const n = numbers(shape.geometry, 4)
  if (!n) return null
  const [x, y, w, h] = n
  if (shape.kind === 'ellipse') return <ellipse cx={x + w / 2} cy={y + h / 2} rx={Math.abs(w) / 2} ry={Math.abs(h) / 2} {...props} />
  return <rect x={x} y={y} width={Math.abs(w)} height={Math.abs(h)} {...props} />
}

// The overlay itself: wrapper-spanning, pointer-events disabled so it
// never steals the very drag it is rendering -- the same conventions
// every other gesture preview on this slot carries.
export function PreviewOverlay({ toolId, decl, testid }: { toolId: string; decl: CanvasPreviewDecl; testid: string }) {
  const viewport = useViewport()
  const drafts = useCanvasDrafts((s) => s.drafts)
  const draft: CanvasDraftRecord | null = liveDraftFor(drafts, toolId)
  // The declaration reads across both halves of the draft: a tool whose
  // preview IS its payload (a rectangle's own geometry) names payload
  // keys; one with drawing-only state names preview keys.
  const shapes = draft ? previewShapes(decl, { ...draft.data, ...draft.preview }) : []
  if (shapes.length === 0) return null
  return (
    <svg data-testid={testid} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
      <g transform={`translate(${viewport.x},${viewport.y}) scale(${viewport.zoom})`}>
        {shapes.map((shape, i) => <PreviewPrimitive key={i} shape={shape} index={i} />)}
      </g>
    </svg>
  )
}

