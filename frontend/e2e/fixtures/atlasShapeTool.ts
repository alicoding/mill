import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { nonSeededBoardObjects } from './atlasBoard'
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
// the seed's own layout changes).
export async function shapeDrawPoints(page: Page, board: Locator, picker?: Locator): Promise<{ from: { x: number; y: number }; to: { x: number; y: number } }> {
  const origin = await findEmptyBoardRect(page, board, SHAPE_DRAW_SIZE, SHAPE_DRAW_SIZE, picker ? [picker] : [])
  return {
    from: { x: origin.x + 15, y: origin.y + 15 },
    to: { x: origin.x + SHAPE_DRAW_SIZE - 15, y: origin.y + SHAPE_DRAW_SIZE - 15 },
  }
}
