import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ATLAS_TOOLS } from './atlasTools'
import type { AtlasBoardNodeType } from './atlasNounRegistry'

// Regression coverage for goal 0193 (resize) and goal 0199's #404/#405
// correction (a board object's own drag surface): every noun's
// `resizable`/`boardNodeType` declaration (atlasNounRegistry.ts, goal
// 0181 S3) is checked against the RENDERER file it names, never against
// AtlasBoardObjectNode.tsx being made per-noun (this goal's own explicit
// non-goal -- #405 put the drag band in the shared renderer on purpose
// so every Kind inherits it by existing, and a per-noun reimplementation
// would recreate exactly the divergence this mechanism exists to kill).
// The check asserts the shared renderer's own markers REACH every noun
// that depends on them, not that each noun re-declares its own copy.
//
// STATIC SOURCE-AUDIT test (see atlasSelectionRingConformance.test.ts's
// header for why this repo uses text-scanning rather than a component-
// render harness): reads each renderer's .tsx source as text and counts
// occurrences of the JSX marker a `resizable: true`/`boardNodeType:
// 'atlas-object'` answer promises. A COUNT-based presence check, not a
// positional one -- it does not prove the marker is reachable for every
// Kind independent of any future per-Kind conditional (a residual limit,
// named here rather than silently assumed away); it DOES fail the exact
// way the historical defect looked: the marker removed from the shared
// renderer entirely.
const atlasDir = dirname(fileURLToPath(import.meta.url))

const RENDERER_FILE: Record<NonNullable<AtlasBoardNodeType>, string> = {
  'atlas-note': 'AtlasNoteCardNode.tsx',
  'atlas-sticky': 'AtlasStickyNode.tsx',
  'atlas-group': 'AtlasGroupNode.tsx',
  'atlas-object': 'AtlasBoardObjectNode.tsx',
}

function rendererSource(boardNodeType: NonNullable<AtlasBoardNodeType>): string {
  return readFileSync(join(atlasDir, RENDERER_FILE[boardNodeType]), 'utf8')
}

function occurrences(source: string, marker: RegExp): number {
  return (source.match(marker) ?? []).length
}

describe('atlas board-object surface conformance (goal 0181 S3, regression for goal 0193)', () => {
  it('backs every "resizable: true" noun with a NodeResizer in its own declared renderer', () => {
    const missing: string[] = []
    for (const tool of ATLAS_TOOLS) {
      if (!tool.resizable) continue
      if (!tool.boardNodeType) {
        missing.push(`${tool.id}: declares resizable: true but boardNodeType: null -- nothing renders it, so nothing can be resized`)
        continue
      }
      const source = rendererSource(tool.boardNodeType)
      if (occurrences(source, /<NodeResizer\b/g) < 1) {
        missing.push(`${tool.id}: resizable: true, but ${RENDERER_FILE[tool.boardNodeType]} has no <NodeResizer -- goal 0193's own regression (no board object was resizable until one renderer got it)`)
      }
    }
    expect(missing).toEqual([])
  })
})

// Regression coverage for goal 0199's #404 correction specifically:
// every Kind routed through the shared 'atlas-object' renderer gets the
// SAME drag surface (a table's own grid, and a diagram viewer's own
// pan/zoom, both capture pointer events a plain node-drag can't reach
// through otherwise). Scoped to 'atlas-object' nouns only -- card/note/
// group already drag from their own chrome and were never part of this
// defect.
describe('atlas board-object drag-surface conformance (goal 0181 S3, regression for goal 0199 #404)', () => {
  it('keeps the shared frame band present for every noun declaring boardNodeType: "atlas-object"', () => {
    const objectNouns = ATLAS_TOOLS.filter((t) => t.boardNodeType === 'atlas-object')
    expect(objectNouns.length, 'expected at least one noun routed through the shared atlas-object renderer').toBeGreaterThan(0)
    const source = rendererSource('atlas-object')
    const frameCount = occurrences(source, /data-testid="atlas-board-object-frame"/g)
    if (frameCount < 1) {
      throw new Error(`AtlasBoardObjectNode.tsx has no atlas-board-object-frame drag band -- every noun routed through it (${objectNouns.map((t) => t.id).join(', ')}) loses its own drag surface (goal 0199's #404 regression)`)
    }
  })
})
