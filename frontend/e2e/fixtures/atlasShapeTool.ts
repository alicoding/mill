import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { nonSeededBoardObjects, type DragEndpoint } from './atlasBoard'
import { contextMenu } from './contextMenu'
import { findEmptyBoardRect } from './atlasEmptyRegion'

// Shared across atlas-shape-tool.spec.ts and atlas-shape-tool-
// interactions.spec.ts (testing.md's "2+ spec files" promotion rule,
// triggered when the interaction-physics tests split out to keep both
// files under the 500-line cap).

export function shapeObjects(page: Page): Locator {
  return nonSeededBoardObjects(page, 'shape')
}

// `position` (optional) targets a specific corner instead of the
// default center -- needed once two objects overlap (goal 0213).
export async function deleteViaContextMenu(page: Page, target: Locator, position?: { x: number; y: number }): Promise<void> {
  await target.click({ button: 'right', position })
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await menu.getByText('Delete', { exact: true }).click()
}

const SHAPE_DRAW_SIZE = 150

// shapeDrawPoints finds a screen rect clear of every currently-rendered
// node (and the style picker's own popover, when open) and returns a
// drag pair inset from its corners -- every shape draw's own start/end
// point, never a fixed viewport fraction (goal 0223's class fix: a raw
// fraction silently lands on whatever the landing board's seeded
// content happens to occupy at that fraction, which shifts the moment
// the seed's own layout changes). Returned as DragEndpoints (board-
// relative, re-resolved against a FRESH board.boundingBox() at the
// moment dragBetween's own hover() actually fires) rather than
// page-absolute points -- board.click()/hover()'s own actionability
// pipeline already re-reads the board's box then, the same
// self-correcting contract boardPoint's callers relied on; an absolute
// point captured once at scan time goes stale against any layout
// shift between the scan and the actual pointer-down (goal 0223's own
// regression: the style picker's own arm animation was enough).
export async function shapeDrawPoints(page: Page, board: Locator, picker?: Locator): Promise<{ from: DragEndpoint; to: DragEndpoint }> {
  const origin = await findEmptyBoardRect(page, board, SHAPE_DRAW_SIZE, SHAPE_DRAW_SIZE, picker ? [picker] : [])
  const boardBox = await board.boundingBox()
  if (!boardBox) throw new Error('shapeDrawPoints: board has no bounding box')
  return {
    from: { locator: board, position: { x: origin.x + 15 - boardBox.x, y: origin.y + 15 - boardBox.y } },
    to: { locator: board, position: { x: origin.x + SHAPE_DRAW_SIZE - 15 - boardBox.x, y: origin.y + SHAPE_DRAW_SIZE - 15 - boardBox.y } },
  }
}
