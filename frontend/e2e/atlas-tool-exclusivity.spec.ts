import { test, expect } from './fixtures/server'
import { contextMenu } from './fixtures/contextMenu'
import { boardPoint, dragBetween } from './fixtures/atlasBoard'
import { clickAtlasTrayTool } from './fixtures/atlasTray'

// Goal 0238: at most one canvas tool armed at any time, radio-group
// exclusive like every other canvas app. Traced live (not the goal
// file's own hypothesis): pencil/eraser/laser/card/note/area/shape
// already shared ONE `arm` state in useAtlasCreation.ts before this
// goal, so that pair was never actually reproducible -- the real bug
// crossed a DIFFERENT boundary: Table's own size-picker
// (useTablePickerSignal.ts) and Image's own popover
// (useAtlasImagePopoverSignal.ts) each held a fully independent open
// boolean, so arming pencil then opening either one left BOTH tray
// buttons reading data-armed="true" at once. useAtlasArmedTool.ts now
// gives every arming door -- the 'arm'-kind tools, Table's picker,
// Image's popover -- the exact same shared field, so exclusivity holds
// for the pair the goal named too (pinned below as a same-family
// regression) and for the pair that actually reproduced the defect.
//
// Goal 0224 changed WHAT this proves for a same-family pair
// specifically: the Annotate drawer now closes the instant one of its
// own tools arms (the one-AnchoredOverlay design, QUARANTINE.md's own
// entry), so eraser's own button doesn't exist at all while pencil is
// armed -- exclusivity within the family is enforced structurally, not
// just by the shared field. Switching to a different family member
// still goes through that same field, via clickAtlasTrayTool's own
// fallback (Escape disarms whatever's armed, reopening the drawer).
test('the Annotate drawer only ever arms one member tool at a time (same-family pair)', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  const pencilTool = page.getByTestId('atlas-tray-pencil')

  await clickAtlasTrayTool(page, 'atlas-tray-pencil')
  await expect(pencilTool).toHaveAttribute('data-armed', 'true')
  await expect(page.getByTestId('atlas-tray-eraser')).toHaveCount(0)

  const eraserTool = page.getByTestId('atlas-tray-eraser')
  await clickAtlasTrayTool(page, 'atlas-tray-eraser')
  await expect(eraserTool).toHaveAttribute('data-armed', 'true')
  await expect(pencilTool).not.toBeVisible()
})

// The sticky (pencil, stays armed across strokes)/non-sticky (card,
// disarms after one placement) pair the goal's own acceptance
// criteria names -- both arm through the SAME field regardless of
// their own commit behaviour.
test('arming card while pencil is armed disarms pencil (sticky/non-sticky pair)', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  const pencilTool = page.getByTestId('atlas-tray-pencil')
  const cardTool = page.getByTestId('atlas-tray-card')

  await clickAtlasTrayTool(page, 'atlas-tray-pencil')
  await expect(pencilTool).toHaveAttribute('data-armed', 'true')

  await cardTool.click()
  await expect(cardTool).toHaveAttribute('data-armed', 'true')
  // Pencil's disarm closes the Annotate group too (goal 0224's
  // useLayoutEffect, AtlasCreationTray.tsx) -- its own button leaves
  // the DOM entirely, not just paints unarmed.
  await expect(pencilTool).not.toBeVisible()

  // Cleanup: disarm the card tool rather than placing one.
  await page.keyboard.press('Escape')
  await expect(cardTool).toHaveAttribute('data-armed', 'false')
})

// The actual reproducible mechanism (traced live against unmodified
// code): Table's own picker used to hold a fully independent open
// boolean, so it never disarmed a pencil already armed via
// useAtlasCreation's own (separate) arm state, and vice versa.
test('arming the table picker while pencil is armed disarms pencil, and back again', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  const pencilTool = page.getByTestId('atlas-tray-pencil')
  const tableTool = page.getByTestId('atlas-tray-table')

  await clickAtlasTrayTool(page, 'atlas-tray-pencil')
  await expect(pencilTool).toHaveAttribute('data-armed', 'true')

  await tableTool.click()
  await expect(tableTool).toHaveAttribute('data-armed', 'true')
  // Pencil's disarm closes the Annotate group too (goal 0224's
  // useLayoutEffect) -- its button leaves the DOM entirely, not just
  // paints unarmed.
  await expect(pencilTool).not.toBeVisible()
  await expect(page.getByTestId('atlas-table-size-2x2')).toBeVisible()

  // Picking a size moves into the placement-pending phase -- still
  // armed as 'table' (the picker popover itself closes), so re-arming
  // pencil now must tear that state down too, not just the popover.
  await page.getByTestId('atlas-table-size-2x2').click()
  await expect(tableTool).toHaveAttribute('data-armed', 'true')

  await clickAtlasTrayTool(page, 'atlas-tray-pencil')
  await expect(pencilTool).toHaveAttribute('data-armed', 'true')
  await expect(tableTool).toHaveAttribute('data-armed', 'false')

  // The stale pending table size must be gone, not just visually --
  // a canvas click now draws ink, never places an orphaned table.
  const tableObjects = page.locator('[data-testid="atlas-board-object"][data-object-kind="table"]')
  const inkObjects = page.locator('[data-testid="atlas-board-object"][data-object-kind="ink"]')
  const board = page.getByTestId('atlas-board')
  await dragBetween(page, await boardPoint(board, 0.05, 0.1), await boardPoint(board, 0.15, 0.2))
  await expect(inkObjects).toHaveCount(1)
  await expect(tableObjects).toHaveCount(0)

  await inkObjects.first().click({ button: 'right' })
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await menu.getByText('Delete', { exact: true }).click()
  await expect(inkObjects).toHaveCount(0)
})

// Same cross-family mechanism, the other direction: Image's own
// popover used to hold its own independent open boolean too.
test('arming the image popover while pencil is armed disarms pencil, and back again', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  const pencilTool = page.getByTestId('atlas-tray-pencil')
  const imageTool = page.getByTestId('atlas-tray-image')

  await clickAtlasTrayTool(page, 'atlas-tray-pencil')
  await expect(pencilTool).toHaveAttribute('data-armed', 'true')

  await clickAtlasTrayTool(page, 'atlas-tray-image')
  await expect(imageTool).toHaveAttribute('data-armed', 'true')
  // Arming a tool gives it its family's whole dock slot (goal 0355):
  // pencil's button leaves the DOM entirely and the Annotate trigger
  // takes its place, rather than merely painting unarmed.
  await expect(pencilTool).not.toBeVisible()
  await expect(page.getByTestId('atlas-tray-annotate-group')).toBeVisible()

  await clickAtlasTrayTool(page, 'atlas-tray-pencil')
  await expect(pencilTool).toHaveAttribute('data-armed', 'true')
  // ...and symmetrically: Image is back inside the Media flyout.
  await expect(imageTool).not.toBeVisible()
  await expect(page.getByTestId('atlas-tray-media-group')).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(pencilTool).not.toBeVisible()
})

// Goal 0224's tray-restructure slice: Shape/Pencil/Eraser/Laser moved
// into the tray's own collapsed Annotate group, but they still share
// the ONE armedToolId field (useAtlasArmedTool.ts) every other tool
// does -- the group is presentation, not a second exclusivity domain.
// Crosses the boundary in both directions: a knowledge tool (Card,
// rendered flat in the tray) disarms an armed annotate tool, and vice
// versa.
test('exclusivity holds across the knowledge/annotate tray boundary, both directions', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  const cardTool = page.getByTestId('atlas-tray-card')
  const pencilTool = page.getByTestId('atlas-tray-pencil')

  // Knowledge armed first, then an annotate tool -- only the latter
  // stays armed, and the card button (never hidden behind a group)
  // reflects the disarm immediately.
  await cardTool.click()
  await expect(cardTool).toHaveAttribute('data-armed', 'true')

  await clickAtlasTrayTool(page, 'atlas-tray-pencil')
  await expect(pencilTool).toHaveAttribute('data-armed', 'true')
  await expect(cardTool).toHaveAttribute('data-armed', 'false')

  // Annotate armed first, then a knowledge tool -- only the latter
  // stays armed, and the Annotate group collapses along with the
  // disarm (goal 0224's useLayoutEffect), so Pencil's own button
  // leaves the DOM.
  await cardTool.click()
  await expect(cardTool).toHaveAttribute('data-armed', 'true')
  await expect(pencilTool).not.toBeVisible()

  // Cleanup: disarm the card tool rather than placing one.
  await page.keyboard.press('Escape')
  await expect(cardTool).toHaveAttribute('data-armed', 'false')
})

// The Annotate group's own trigger (goal 0224): collapsed by default,
// expands on click to reveal shape/pencil/eraser/laser. Arming one of
// them SWAPS the trigger out for that tool's own flat button in the
// exact same tray slot -- never both at once, the one-AnchoredOverlay
// invariant a real regression (QUARANTINE.md's own entry) proved
// necessary: nesting the drawer's own popover around an armed tool's
// style-panel popover broke Space-to-pan.
test('the Annotate group starts collapsed, expands to arm a tool, and the trigger returns once nothing is armed', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  const group = page.getByTestId('atlas-tray-annotate-group')
  const pencilTool = page.getByTestId('atlas-tray-pencil')

  await expect(group).toBeVisible()
  await expect(pencilTool).not.toBeVisible()

  await group.click()
  await expect(pencilTool).toBeVisible()
  // Browsing the drawer never arms anything -- the trigger is still
  // the visible slot, pencil is just one of four choices inside it.
  await expect(group).toBeVisible()

  await pencilTool.click()
  await expect(pencilTool).toHaveAttribute('data-armed', 'true')
  // Pencil's own button now occupies the tray slot the trigger used
  // to -- the generic trigger is gone, not just collapsed.
  await expect(group).not.toBeVisible()

  await page.keyboard.press('Escape')
  // Disarming brings the collapsed trigger back, not a re-opened
  // drawer (goal 0224's useLayoutEffect resets the browsing flag the
  // moment a tool arms, so a LATER disarm never re-opens it uninvited).
  await expect(pencilTool).not.toBeVisible()
  await expect(group).toBeVisible()
})
