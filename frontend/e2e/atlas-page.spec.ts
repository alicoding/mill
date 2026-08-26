import { test, expect } from './fixtures/server'
import { openToolbarAction } from './fixtures/toolbarActions'
import { deleteViaPageMenu } from './fixtures/atlasPage'
import { armAndPlaceTopicCard, clickBreadcrumbSegment, clickFrameGutter, openCard } from './fixtures/atlasBoard'

// Exercises the card PAGE's own ratified anatomy (goal 0072 slice C,
// docs/adr/0038): the header row (kind glyph/circle, title, file tag,
// Close), the two-column Contents/meta-rail body, and a region frame's
// own click model -- split out of atlas.spec.ts (architecture.md's
// 500-line convention), same family split atlas-share.spec.ts/
// atlas-jump.spec.ts/atlas-projections.spec.ts already established.
// That file's own header covers the shared egocentric-root auto-entry
// behavior every test below relies on.

function noteCard(page: import('@playwright/test').Page, title: string) {
  return page.locator(`[data-testid="atlas-note-card"][aria-label="Open ${title}"]`)
}

function groupCard(page: import('@playwright/test').Page, title: string) {
  return page.locator('[data-testid="atlas-group-card"]').filter({ has: page.locator(`[aria-label="Zoom into ${title}"]`) })
}

test('a title-only card\'s page renders calm: title + property strip + write-invitation, nothing else (goal 0106 slice B contract item 3)', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()
  const popover = page.getByTestId('atlas-placement-popover')

  const title = 'ZzE2eCalmPageOnly'
  await armAndPlaceTopicCard(page, board, popover, 0.05, 0.9, title)
  await openCard(page, noteCard(page, title))
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay).toBeVisible()
  await expect(overlay.getByTestId('atlas-page-title')).toHaveValue(title)

  // Property strip: kind label + the Topic kind's own "status" field
  // as a chip (its declared Default, since a fresh card carries no
  // explicit Fields value yet) -- no freshness dot on an unmirrored
  // card.
  const strip = overlay.getByTestId('atlas-page-property-strip')
  await expect(strip).toBeVisible()
  await expect(strip.getByTestId('atlas-page-kind-label')).toHaveText('Topic')
  await expect(strip.getByTestId('atlas-page-status-chip')).toHaveText('Open')
  await expect(strip.getByTestId('atlas-page-freshness-dot')).toHaveCount(0)

  // Borderless write-invitation: empty, placeholder only.
  // An empty note IS the editor (goal 0145) -- the CodeEditor mount
  // with its placeholder is the write invitation.
  const note = overlay.getByTestId('atlas-page-note')
  await expect(note).toBeVisible()
  await expect(note).toContainText('Write anything…')

  // The Topic kind's OTHER declared field (Summary) collapses to its
  // own one-line invitation -- status itself never appears here, since
  // it's already the strip's own chip above.
  await expect(overlay.getByTestId('atlas-page-add-field')).toHaveText('+ Add Summary')

  // Kind-gated Source/Mirror path never render at all for a non-mirror
  // kind, filled OR collapsed.
  await expect(overlay.getByTestId('atlas-page-source')).toHaveCount(0)
  await expect(overlay.getByTestId('atlas-page-add-source')).toHaveCount(0)
  await expect(overlay.getByTestId('atlas-page-mirror-path')).toHaveCount(0)
  await expect(overlay.getByTestId('atlas-page-add-mirror-path')).toHaveCount(0)

  // Actions: bare add row only -- no "Actions" heading, no hint text.
  const actions = overlay.getByTestId('atlas-page-actions')
  await expect(actions.getByTestId('atlas-page-add-action')).toBeVisible()
  await expect(actions.getByTestId('atlas-page-action-row')).toHaveCount(0)
  await expect(actions).not.toContainText('Actions')
  await expect(actions).not.toContainText("Each action receives")

  // Links: the seeded space's one link kind starts collapsed too --
  // no chips, no inline select/Add control visible yet.
  const slotRows = overlay.getByTestId('atlas-slot-rows')
  await expect(slotRows.locator('[data-testid^="atlas-slot-add-row-"]')).toHaveCount(1)
  await expect(slotRows.locator('[data-testid^="atlas-slot-add-select-"]')).toHaveCount(0)
  await expect(slotRows.locator('[data-testid^="atlas-slot-chip"]')).toHaveCount(0)

  // Contents: never mounted at all for a childless, unmirrored card --
  // no "Nothing inside yet" fallback (deleted by this same goal).
  await expect(overlay.getByTestId('atlas-page-contents')).toHaveCount(0)
  await expect(overlay.getByText('Nothing inside yet')).toHaveCount(0)

  // Cleanup (testing.md's within-file discipline).
  await deleteViaPageMenu(page, overlay)
  await expect(overlay).not.toBeVisible()
})

test('the page header shows a kind glyph, title, file tag, and Close; the seeded Contact card gets a circular glyph', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()
  const overlay = page.locator('[data-component="atlas-card-overlay"]')

  await openCard(page, noteCard(page, 'Discovery workstream'))
  await expect(overlay).toBeVisible()
  await expect(overlay.getByTestId('atlas-page-title')).toHaveValue('Discovery workstream')
  const topicGlyph = overlay.getByTestId('atlas-page-glyph')
  await expect(topicGlyph).toHaveText('T')
  expect(await topicGlyph.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('6px')
  await expect(overlay.getByTestId('atlas-page-file-tag')).toHaveCount(0)
  await overlay.getByTestId('atlas-page-close').click()
  await expect(overlay).not.toBeVisible()

  await groupCard(page, 'Client records').getByTestId('atlas-group-header').click()
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Client records')

  await openCard(page, noteCard(page, 'Statement of work'))
  await expect(overlay).toBeVisible()
  await expect(overlay.getByTestId('atlas-page-file-tag')).toHaveText('URL')
  await page.keyboard.press('Escape')
  await expect(overlay).not.toBeVisible()

  await openCard(page, noteCard(page, 'Jordan Reyes'))
  await expect(overlay).toBeVisible()
  const contactGlyph = overlay.getByTestId('atlas-page-glyph')
  expect(await contactGlyph.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('50%')
  await page.keyboard.press('Escape')
})

test('the open page is the top layer: app chrome never paints over it and its backdrop covers the toolbar', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await openCard(page, noteCard(page, 'Discovery workstream'))
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

test('the page\'s links render as slot rows (goal 0081 slice A5), not a second read-only copy of the Contents column', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await openCard(page, noteCard(page, 'Discovery workstream'))
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay).toBeVisible()

  // "Discovery workstream" carries the seeded outgoing "relates to" link to
  // "Jordan Reyes" -- it renders as a chip on the slot row, and the
  // Contents column no longer duplicates it as a separate read-only
  // entry (Note/Links both moved to their own in-place editable
  // controls, LOCKED design §5b "no edit mode").
  const slotChip = overlay.getByTestId('atlas-slot-chip').filter({ hasText: 'Jordan Reyes' })
  await expect(slotChip).toBeVisible()
  await expect(overlay.getByTestId('atlas-page-link')).toHaveCount(0)

  await page.keyboard.press('Escape')
})

test('a region frame\'s body click selects it (never drills); ⌘-click opens the group\'s own page directly; Esc clears the selection', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  const exampleArea = groupCard(page, 'Client records')
  await expect(exampleArea).toBeVisible()
  const exampleAreaWrapper = page.locator('.react-flow__node.selected').filter({ has: exampleArea })

  // A region frame's own body has one reliably blank strip regardless
  // of child count or row layout: the left GROUP_PADDING gutter
  // (atlasBoardLayout.ts), a narrow column between the frame's own left
  // edge and its first column of children, running the full height
  // below the header -- a 1% fraction of width stays inside that gutter
  // whatever the board's current zoom level scales it to.
  await clickFrameGutter(exampleArea)
  await expect(exampleAreaWrapper).toHaveCount(1)
  // The board never re-roots off a plain body click -- the header
  // remains the only unconditional drill affordance.
  await expect(page.getByTestId('atlas-breadcrumb')).not.toContainText('Client records')

  await page.keyboard.press('Escape')
  await expect(exampleAreaWrapper).toHaveCount(0)

  // ⌘-click opens the frame's own page directly (goal 0102's gesture
  // table: ⌘-click = instant commit, the pointer twin of ⌘↵) --
  // reached with no prior selection needed.
  await clickFrameGutter(exampleArea, { modifiers: ['Meta'] })
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay).toBeVisible()
  await expect(overlay.getByTestId('atlas-page-title')).toHaveValue('Client records')
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
  await groupCard(page, 'Client records').getByTestId('atlas-group-header').click()
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Client records')

  const charterCard = noteCard(page, 'Statement of work')
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await openCard(page, charterCard)
  await expect(overlay).toBeVisible()
  // Mirror path starts empty, collapsed behind its own "+ Add"
  // invitation (goal 0106 slice B contract item 3) -- click it to
  // reveal the real control.
  await overlay.getByTestId('atlas-page-add-mirror-path').click()
  await overlay.getByTestId('atlas-page-mirror-path').fill(file)
  await overlay.getByTestId('atlas-page-mirror-path').blur()
  await expect(overlay.getByTestId('atlas-page-saved-tick')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(overlay).not.toBeVisible()

  // The card's own page: meta rail source/mirror/freshness, each a
  // read-only summary of a field the fields column above still owns.
  await openCard(page, charterCard)
  await expect(overlay).toBeVisible()
  await expect(overlay.getByTestId('atlas-page-meta-source')).toContainText('example.com')
  await expect(overlay.getByTestId('atlas-page-meta-mirror')).toContainText('notes.md')
  await expect(overlay.getByTestId('atlas-page-meta-freshness')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(overlay).not.toBeVisible()

  // "Client records"'s own page: "Statement of work" appears as a child
  // entry with its mirror content rendered inline. ⌘-click on the
  // frame's own body opens its page directly (goal 0102's gesture
  // table's instant-commit path).
  await clickBreadcrumbSegment(page, page.getByTestId('atlas-breadcrumb').getByText('The engagement', { exact: true }), 'The engagement')
  const exampleAreaFrame = groupCard(page, 'Client records')
  await clickFrameGutter(exampleAreaFrame, { modifiers: ['Meta'] })
  await expect(overlay).toBeVisible()
  await expect(overlay.getByTestId('atlas-page-title')).toHaveValue('Client records')
  const charterEntry = overlay.getByTestId('atlas-page-child').filter({ hasText: 'Statement of work' })
  await expect(charterEntry).toBeVisible()
  await expect(charterEntry.getByTestId('atlas-mirror-markdown')).toContainText('Charter notes')
  await page.keyboard.press('Escape')
  await expect(overlay).not.toBeVisible()

  // Cleanup: clear the seeded card's mirror path so it doesn't leak
  // into a later test in this same file/worker (testing.md's
  // within-file cleanup discipline).
  await groupCard(page, 'Client records').getByTestId('atlas-group-header').click()
  await openCard(page, charterCard)
  await overlay.getByTestId('atlas-page-mirror-path').fill('')
  await overlay.getByTestId('atlas-page-mirror-path').blur()
  await expect(overlay.getByTestId('atlas-page-saved-tick')).toBeVisible()
  await page.keyboard.press('Escape')
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
// one level deeper than the last (The engagement -> Reports -> Reports ->
// Reports), so the innermost "Reports" is a group entry that is NOT
// part of the outer board's own rendered neighborhood.
test('a group entry inside a page re-roots the board to a deeper card, and the breadcrumb reflects it', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  async function importReportsOnly() {
    await openToolbarAction(page, 'atlas-add-from-folder')
    const dialog = page.locator('[data-component="atlas-folder-import-dialog"]')
    await expect(dialog).toBeVisible()
    // Dedupe (goal 0088) default-unchecks rows whose content an
    // earlier import in this worker already mirrored -- make the
    // intended set explicit: check everything, then drop the three
    // this setup never wants, so the count below is deterministic
    // regardless of test order.
    const boxes = dialog.getByRole('checkbox')
    for (let i = 0; i < await boxes.count(); i++) {
      const box = boxes.nth(i)
      if (!(await box.isChecked())) await box.check()
    }
    await dialog.getByRole('checkbox', { name: 'Meeting Notes' }).uncheck()
    await dialog.getByRole('checkbox', { name: 'Project Plan' }).uncheck()
    await dialog.getByRole('checkbox', { name: 'Logo' }).uncheck()
    await dialog.getByRole('button', { name: 'Add 2 cards' }).click()
    await expect(dialog).not.toBeVisible()
  }

  // Round 1: "Reports" lands as a top-level child of "The engagement".
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

  // Back to "The engagement": L1 is a top-level frame, and L2 -- itself a
  // group -- previews inside it as a REGION CHIP (goal 0073). The path
  // to L2's page is therefore the place path: drill into L1 so L2
  // becomes a top-level frame, ⌘-click its body to open its own page
  // directly (goal 0102's gesture table's instant-commit path).
  await clickBreadcrumbSegment(page, page.getByTestId('atlas-breadcrumb').getByText('The engagement', { exact: true }), 'The engagement')
  const breadcrumb = page.getByTestId('atlas-breadcrumb')
  await expect(breadcrumb).not.toContainText('Reports')
  await expect(page.getByTestId('atlas-region-chip').filter({ hasText: 'Reports' })).toBeVisible()

  await l1.getByTestId('atlas-group-header').click()
  await expect(breadcrumbReports).toHaveCount(1)
  const l2Frame = groupCard(page, 'Reports')
  // The frame's centre is covered by its own preview-child nodes
  // (separate React Flow nodes on top) -- click the frame's own left
  // padding strip, below the header inset, where only the frame is.
  await l2Frame.click({ position: { x: 6, y: 60 }, modifiers: ['Meta'] })
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
  async function deleteViaCommit(card: import('@playwright/test').Locator) {
    await openCard(page, card)
    await deleteViaPageMenu(page, overlay)
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
  // means to open.
  await l3Chip.dblclick()
  await expect(breadcrumbReports).toHaveCount(3)
  await deleteViaCommit(noteCard(page, 'Q1 Summary'))
  await clickBreadcrumbSegment(page, page.getByTestId('atlas-breadcrumb').getByText('Reports').nth(1), 'Reports')
  await deleteViaCommit(noteCard(page, 'Reports'))

  // L2's other child (its own Q1 Summary).
  await deleteViaCommit(noteCard(page, 'Q1 Summary'))

  // Up to L1: delete L2 (now childless) and L1's own Q1 Summary.
  await clickBreadcrumbSegment(page, page.getByTestId('atlas-breadcrumb').getByText('Reports').first(), 'Reports')
  await deleteViaCommit(noteCard(page, 'Reports'))
  await deleteViaCommit(noteCard(page, 'Q1 Summary'))

  // Back to "The engagement": delete L1.
  await clickBreadcrumbSegment(page, page.getByTestId('atlas-breadcrumb').getByText('The engagement', { exact: true }), 'The engagement')
  await deleteViaCommit(noteCard(page, 'Reports'))
  await expect(breadcrumb).not.toContainText('Reports')
})
