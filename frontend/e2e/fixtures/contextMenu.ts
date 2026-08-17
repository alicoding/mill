import type { Locator, Page } from '@playwright/test'

// Promoted out of context-menu.spec.ts (goal 0081 slice A1, testing.md's
// "a helper used by 2+ spec files MUST be promoted" rule) once
// atlas-authoring.spec.ts needed the same right-click plumbing.

// The one shared Primer-native right-click menu (goal 0075) -- every
// surface's own context menu renders through this one overlay.
export function contextMenu(page: Page): Locator {
  return page.getByTestId('context-menu')
}

// Right-clicks a point inside `locator`'s own bounding box that's
// empty background -- every board/canvas this helper targets lays its
// cards/nodes out in a single row near vertical center after fitView's
// padding, so the bottom-left corner is always clear of any node.
export async function rightClickEmptyArea(locator: Locator, position?: { x: number; y: number }): Promise<void> {
  const box = await locator.boundingBox()
  if (!box) throw new Error('empty-area target has no bounding box')
  await locator.click({ button: 'right', position: position ?? { x: 12, y: box.height - 12 } })
}
