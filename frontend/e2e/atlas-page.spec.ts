import { test, expect } from './fixtures/server'
import { openCardPageEdit } from './fixtures/atlasPage'

// Exercises the card PAGE's own ratified anatomy (goal 0072 slice C,
// docs/adr/0038): the header row (kind glyph/circle, title, file tag,
// Close), the two-column Contents/meta-rail body, and a region frame's
// own body-click flip -- split out of atlas.spec.ts (architecture.md's
// 500-line convention), same family split atlas-share.spec.ts/
// atlas-jump.spec.ts/atlas-projections.spec.ts already established.
// That file's own header covers the shared egocentric-root auto-entry
// behavior every test below relies on.

function noteCard(page: import('@playwright/test').Page, title: string) {
  return page.locator(`[data-testid="atlas-note-card"][aria-label="Flip ${title}"]`)
}

function groupCard(page: import('@playwright/test').Page, title: string) {
  return page.locator('[data-testid="atlas-group-card"]').filter({ has: page.locator(`[aria-label="Zoom into ${title}"]`) })
}

async function openViaFlip(card: import('@playwright/test').Locator) {
  if ((await card.getAttribute('data-flipped')) !== 'true') {
    await card.click()
    await expect(card).toHaveAttribute('data-flipped', 'true')
  }
  await card.getByTestId('atlas-note-open').click()
}

// A region frame's own body has one reliably blank strip regardless
// of child count or row layout: the left GROUP_PADDING gutter
// (atlasBoardLayout.ts), a narrow column between the frame's own left
// edge and its first column of children, running the full height
// below the header. Locator.click's own `position` is resolved
// against the element's CURRENT box at the moment of the click (with
// its usual actionability wait), not a one-off boundingBox() snapshot
// that could go stale if the board's own initial fitView animation is
// still settling -- a 1% fraction of width stays inside that gutter
// whatever the board's current zoom level scales it to.
async function clickFrameBody(frame: import('@playwright/test').Locator) {
  const box = await frame.boundingBox()
  if (!box) throw new Error('expected the frame to be measurable')
  await frame.click({ position: { x: box.width * 0.01, y: box.height * 0.5 } })
}

test('the page header shows a kind glyph, title, file tag, and Close; the seeded Contact card gets a circular glyph', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()
  const overlay = page.locator('[data-component="atlas-card-overlay"]')

  await openViaFlip(noteCard(page, 'Getting started'))
  await expect(overlay).toBeVisible()
  await expect(overlay.getByTestId('atlas-page-title')).toHaveText('Getting started')
  const topicGlyph = overlay.getByTestId('atlas-page-glyph')
  await expect(topicGlyph).toHaveText('T')
  expect(await topicGlyph.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('6px')
  await expect(overlay.getByTestId('atlas-page-file-tag')).toHaveCount(0)
  await overlay.getByTestId('atlas-page-close').click()
  await expect(overlay).not.toBeVisible()

  await groupCard(page, 'Example area').getByTestId('atlas-group-header').click()
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Example area')

  await openViaFlip(noteCard(page, 'Project charter'))
  await expect(overlay).toBeVisible()
  await expect(overlay.getByTestId('atlas-page-file-tag')).toHaveText('URL')
  await page.keyboard.press('Escape')
  await expect(overlay).not.toBeVisible()

  await openViaFlip(noteCard(page, 'Ada Lovelace'))
  await expect(overlay).toBeVisible()
  const contactGlyph = overlay.getByTestId('atlas-page-glyph')
  expect(await contactGlyph.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('50%')
  await page.keyboard.press('Escape')
})

test('the open page is the top layer: app chrome never paints over it and its backdrop covers the toolbar', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await openViaFlip(noteCard(page, 'Getting started'))
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay).toBeVisible()

  // Regression: the kit portals dialogs into a wrapper stuck at an
  // inline z-index:1, so the titlebar/toolbar/board-controls painted
  // OVER the sheet (the Close button sat half-hidden behind the
  // toolbar). Assert by hit-testing, the same way a user's click
  // resolves: the Close button's own centre must belong to the
  // dialog, and a point over the toolbar row must hit the backdrop,
  // never a toolbar button.
  const hits = await page.evaluate(() => {
    const dlg = document.querySelector('[data-component="atlas-card-overlay"]')
    if (!dlg) return null
    const close = dlg.querySelector('[data-testid="atlas-page-close"]')
    if (!close) return null
    const c = close.getBoundingClientRect()
    const closeHit = document.elementFromPoint(c.x + c.width / 2, c.y + c.height / 2)
    const toolbarHit = document.elementFromPoint(window.innerWidth - 60, 95)
    return {
      closeIsDialogs: !!closeHit?.closest('[data-component="atlas-card-overlay"]'),
      toolbarCovered: !toolbarHit?.closest('button') || !!toolbarHit?.closest('[data-component="atlas-card-overlay"]'),
    }
  })
  expect(hits?.closeIsDialogs).toBe(true)
  expect(hits?.toolbarCovered).toBe(true)
  await page.keyboard.press('Escape')
  await expect(overlay).not.toBeVisible()
})

test('a linked Contact card renders as an avatar person row inside the parent page\'s Contents', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await openViaFlip(noteCard(page, 'Getting started'))
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay).toBeVisible()

  const linkEntry = overlay.getByTestId('atlas-page-link').filter({ hasText: 'Ada Lovelace' })
  await expect(linkEntry).toBeVisible()
  await expect(linkEntry).toHaveAttribute('data-contact', 'true')
  const personRow = linkEntry.getByTestId('atlas-page-link-person')
  await expect(personRow).toBeVisible()
  await expect(personRow).toContainText('Ada Lovelace')

  await page.keyboard.press('Escape')
})

test('a region frame\'s body click flips it in place; Esc unflips; Open on the back opens the group\'s own page', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  const exampleArea = groupCard(page, 'Example area')
  await expect(exampleArea).toBeVisible()

  await clickFrameBody(exampleArea)
  await expect(exampleArea).toHaveAttribute('data-flipped', 'true')
  const back = exampleArea.getByTestId('atlas-group-card-back')
  await expect(back).toBeVisible()
  await expect(back).toContainText('2 cards')

  await page.keyboard.press('Escape')
  await expect(exampleArea).toHaveAttribute('data-flipped', 'false')

  await clickFrameBody(exampleArea)
  await expect(exampleArea).toHaveAttribute('data-flipped', 'true')
  await exampleArea.getByTestId('atlas-group-open').click()

  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay).toBeVisible()
  await expect(overlay.getByTestId('atlas-page-title')).toHaveText('Example area')
  await page.keyboard.press('Escape')
  await expect(overlay).not.toBeVisible()
})

test('a child\'s mirror preview renders inline in the parent page; the card\'s own page shows source/mirror/freshness in the meta rail', async ({ page }) => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mill-e2e-atlas-page-'))
  const file = path.join(dir, 'notes.md')
  fs.writeFileSync(file, '# Charter notes\n\nSet by the e2e suite.')

  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await groupCard(page, 'Example area').getByTestId('atlas-group-header').click()
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Example area')

  const charterCard = noteCard(page, 'Project charter')
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await openViaFlip(charterCard)
  await expect(overlay).toBeVisible()
  await openCardPageEdit(page)
  await overlay.getByTestId('atlas-overlay-mirror-path').fill(file)
  await overlay.getByTestId('atlas-overlay-save').click()
  await expect(overlay).not.toBeVisible()

  // The card's own page: meta rail source/mirror/freshness, each a
  // read-only summary of a field the edit section below Contents still
  // owns.
  await openViaFlip(charterCard)
  await expect(overlay).toBeVisible()
  await expect(overlay.getByTestId('atlas-page-meta-source')).toContainText('example.com')
  await expect(overlay.getByTestId('atlas-page-meta-mirror')).toContainText('notes.md')
  await expect(overlay.getByTestId('atlas-page-meta-freshness')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(overlay).not.toBeVisible()

  // "Example area"'s own page: "Project charter" appears as a child
  // entry with its mirror content rendered inline.
  await page.getByTestId('atlas-breadcrumb').getByText('My space', { exact: true }).click()
  const exampleAreaFrame = groupCard(page, 'Example area')
  await clickFrameBody(exampleAreaFrame)
  await expect(exampleAreaFrame.getByTestId('atlas-group-card-back')).toBeVisible()
  await exampleAreaFrame.getByTestId('atlas-group-open').click()
  await expect(overlay).toBeVisible()
  await expect(overlay.getByTestId('atlas-page-title')).toHaveText('Example area')
  const charterEntry = overlay.getByTestId('atlas-page-child').filter({ hasText: 'Project charter' })
  await expect(charterEntry).toBeVisible()
  await expect(charterEntry.getByTestId('atlas-mirror-markdown')).toContainText('Charter notes')
  await page.keyboard.press('Escape')
  await expect(overlay).not.toBeVisible()

  // Cleanup: clear the seeded card's mirror path so it doesn't leak
  // into a later test in this same file/worker (testing.md's
  // within-file cleanup discipline).
  await groupCard(page, 'Example area').getByTestId('atlas-group-header').click()
  await openViaFlip(charterCard)
  await openCardPageEdit(page)
  await overlay.getByTestId('atlas-overlay-mirror-path').fill('')
  await overlay.getByTestId('atlas-overlay-save').click()
  await expect(overlay).not.toBeVisible()
})

// Proves the group-entry click's own re-root (goal 0072 slice C item
// 2: "reuse slice B's focus plumbing") against a case the board's
// existing 1-level-deep preview mechanism can NOT already satisfy in
// place -- the target must be more than one level below the currently
// viewed board's own top-level children, which the seed alone doesn't
// reach. Built via three rounds of the existing synced-folder fixture
// import (goal 0067), reused as-is rather than adding fixture depth
// that would perturb atlas-folder-import.spec.ts's own exact counts:
// each round imports "Reports" (a container) + its nested "Q1 Summary"
// one level deeper than the last (My space -> Reports -> Reports ->
// Reports), so the innermost "Reports" is a group entry that is NOT
// part of the outer board's own rendered neighborhood.
test('a group entry inside a page re-roots the board to a deeper card, and the breadcrumb reflects it', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  async function importReportsOnly() {
    await page.getByTestId('atlas-add-from-folder').click()
    const dialog = page.locator('[data-component="atlas-folder-import-dialog"]')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('checkbox', { name: 'Meeting Notes' }).uncheck()
    await dialog.getByRole('checkbox', { name: 'Project Plan' }).uncheck()
    await dialog.getByRole('checkbox', { name: 'Logo' }).uncheck()
    await dialog.getByRole('button', { name: 'Add 2 cards' }).click()
    await expect(dialog).not.toBeVisible()
  }

  // Round 1: "Reports" lands as a top-level child of "My space".
  await importReportsOnly()
  const l1 = groupCard(page, 'Reports')
  await expect(l1).toBeVisible()

  // Round 2: drill into L1, import again -- its own nested "Reports"
  // (L2) is now a group one level inside L1. L1 is ALSO titled
  // "Reports", so a plain toContainText check can't tell "still on
  // L1" apart from "drilled into L2" -- wait for the breadcrumb's own
  // SECOND "Reports" crumb specifically (asserting a count, not just a
  // substring), so this doesn't race ahead of handleDrill's own
  // fitBounds-then-reroot animation.
  const breadcrumbReports = page.getByTestId('atlas-breadcrumb').getByText('Reports')
  await l1.getByTestId('atlas-group-header').click()
  await expect(breadcrumbReports).toHaveCount(1)
  await importReportsOnly()
  const l2 = groupCard(page, 'Reports')
  await expect(l2).toBeVisible()

  // Round 3: drill into L2, import again -- L2 now holds its own
  // nested group (L3), the entry this test actually clicks.
  await l2.getByTestId('atlas-group-header').click()
  await expect(breadcrumbReports).toHaveCount(2)
  await importReportsOnly()
  const l3 = groupCard(page, 'Reports')
  await expect(l3).toBeVisible()

  // Back to "My space": L1 is a top-level frame, and L2 -- itself a
  // group -- previews inside it as a REGION CHIP (goal 0073), a place
  // with no flip face. The path to L2's page is therefore the place
  // path: drill into L1 so L2 becomes a top-level frame, flip its
  // body, Open.
  await page.getByTestId('atlas-breadcrumb').getByText('My space', { exact: true }).click()
  const breadcrumb = page.getByTestId('atlas-breadcrumb')
  await expect(breadcrumb).not.toContainText('Reports')
  await expect(page.getByTestId('atlas-region-chip').filter({ hasText: 'Reports' })).toBeVisible()

  await l1.getByTestId('atlas-group-header').click()
  await expect(breadcrumbReports).toHaveCount(1)
  const l2Frame = groupCard(page, 'Reports')
  // The frame's centre is covered by its own preview-child nodes
  // (separate React Flow nodes on top) -- click the frame's own left
  // padding strip, below the header inset, where only the frame is.
  await l2Frame.click({ position: { x: 6, y: 60 } })
  await expect(l2Frame).toHaveAttribute('data-flipped', 'true')
  await l2Frame.getByTestId('atlas-group-open').click()
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay).toBeVisible()

  // L3 -- L2's own nested group -- is a clickable group entry inside
  // L2's page. On L1's board L3 IS already visible (as L2's preview
  // region chip, goal 0073), so the entry click lands attention in
  // place: overlay closes, no re-root (the crumb count stays 1), and
  // the CHIP pulses -- the same "fly, don't commit" semantics ⌘K's
  // plain Enter carries.
  const l3Entry = overlay.getByTestId('atlas-page-child-group').filter({ hasText: 'Reports' })
  await expect(l3Entry).toBeVisible()
  await l3Entry.click()

  await expect(overlay).not.toBeVisible()
  await expect(breadcrumbReports).toHaveCount(1)
  const l3Chip = page.getByTestId('atlas-region-chip').filter({ hasText: 'Reports' })
  await expect(l3Chip).toHaveAttribute('data-pulse', 'true')

  // Cleanup (testing.md's within-file discipline): delete bottom-up,
  // since atlassvc.DeleteCard is blocked while a card still has
  // children. A chip is a place: clicking it drills straight to L3.
  async function deleteViaFlip(card: import('@playwright/test').Locator) {
    await openViaFlip(card)
    await openCardPageEdit(page)
    await overlay.getByTestId('atlas-overlay-delete').click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
    await expect(overlay).not.toBeVisible()
  }

  // Inside L3 (the chip click drills straight there): delete its
  // own nested Q1 Summary first (DeleteCard blocks while children
  // exist), then go back up to L2 -- L3 is childless now, so it
  // renders as a plain leaf note there -- and delete L3 itself. Waits
  // for the breadcrumb's own THIRD "Reports" crumb before querying
  // the board -- same handleDrill fly-then-reroot race the earlier
  // rounds already guard against: querying immediately after the
  // click can still catch L2's own board, where L3 (not yet drilled
  // into) renders as a frame with its own child ALSO previewed one
  // level deep, so "Q1 Summary" would match twice (L2's own child and
  // L3's preview grandchild) rather than the single card this step
  // means to flip.
  await l3Chip.dblclick()
  await expect(breadcrumbReports).toHaveCount(3)
  await deleteViaFlip(noteCard(page, 'Q1 Summary'))
  await page.getByTestId('atlas-breadcrumb').getByText('Reports').nth(1).click()
  await deleteViaFlip(noteCard(page, 'Reports'))

  // L2's other child (its own Q1 Summary).
  await deleteViaFlip(noteCard(page, 'Q1 Summary'))

  // Up to L1: delete L2 (now childless) and L1's own Q1 Summary.
  await page.getByTestId('atlas-breadcrumb').getByText('Reports').first().click()
  await deleteViaFlip(noteCard(page, 'Reports'))
  await deleteViaFlip(noteCard(page, 'Q1 Summary'))

  // Back to "My space": delete L1.
  await page.getByTestId('atlas-breadcrumb').getByText('My space', { exact: true }).click()
  await deleteViaFlip(noteCard(page, 'Reports'))
  await expect(breadcrumb).not.toContainText('Reports')
})
