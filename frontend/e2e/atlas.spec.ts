import { test, expect } from './fixtures/server'
import { openToolbarAction } from './fixtures/toolbarActions'
import { fillMarkdownNote, clickOutsideNoteEditor } from './fixtures/codeEditor'
import { deleteViaPageMenu } from './fixtures/atlasPage'
import { ATLAS_KIND_TOPIC, selectKind } from './fixtures/kindPicker'
import { clickBreadcrumbSegment, openCard, createCardViaTray } from './fixtures/atlasBoard'

// Exercises the Atlas surface's one-map board (docs/adr/0038,
// goal 0072 slice A: AtlasShelves retired, every level renders through
// AtlasBoard) over real Go bindings (Wails3 server mode): the seeded
// root/The engagement space (Client records, Discovery workstream, Scratchpad)
// proves auto-entry, drill via a region frame's own header, the click
// model (select -> commit, goal 0102), the explicit sibling-vs-child
// create flow, the per-space lens, and Quick Panel's card search -- the
// same seeded-example-is-the-proof pattern every other e2e spec in this
// suite follows. Seeded names ("The engagement", "Client records",
// "Discovery workstream", "Scratchpad", "Contact", "Jordan Reyes") are
// used here to assert against the real seed (.claude/rules/testing.md:
// fine in e2e specs, never in frontend/src). With exactly one seeded
// root card, the surface auto-enters it -- every test below already
// lands on "The engagement" without needing to click it, and the
// "All spaces" meta-level crumb is absent unless a test explicitly
// creates a second root card.
// The share (goal 0063), projection (goal 0064), and Auto-arrange
// (goals 0089/0265) test groups live in sibling files,
// atlas-share.spec.ts, atlas-projections.spec.ts and
// atlas-arrange.spec.ts -- split out to stay under architecture.md's
// 500-line convention, same pattern composition.spec.ts/
// composition-canvas-interactions.spec.ts already established.

function atlasView(page: import('@playwright/test').Page) {
  return page.getByTestId('atlas-view')
}

// Precise per-card matching: aria-label carries the exact title.
function noteCard(page: import('@playwright/test').Page, title: string) {
  return page.locator(`[data-testid="atlas-note-card"][aria-label="Open ${title}"]`)
}

function groupCard(page: import('@playwright/test').Page, title: string) {
  return page.locator('[data-testid="atlas-group-card"]').filter({ has: page.locator(`[aria-label="Zoom into ${title}"]`) })
}


test('the board fills the view pane height instead of collapsing to its min-height floor', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  // Regression: the page tab's panel div carried no height rule, so
  // the board's height:100% resolved against auto and collapsed to
  // its 480px min-height floor, leaving the lower half of the window
  // as dead whitespace. The board's bottom edge must reach (near)
  // the bottom of the viewport -- the ~100px allowance covers the
  // footer band + page padding, not a second collapse (the collapsed
  // board bottomed out ~150px higher still).
  const viewport = page.viewportSize()
  if (!viewport) throw new Error('viewport size unavailable')
  const box = await board.boundingBox()
  if (!box) throw new Error('board bounding box unavailable')
  expect(box.y + box.height).toBeGreaterThan(viewport.height - 100)
})

test('the seeded single root auto-enters "The engagement"; drilling into a region frame via its header works across both board modes', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(atlasView(page)).toBeVisible()

  // Auto-entry (ADR-0038's egocentric-root principle): with exactly one
  // root card, the surface opens already drilled into it -- "The
  // engagement" is visible immediately, no click required. The "All
  // spaces" crumb renders too (goal 0221): one visible click out, even
  // from this auto-entered state.
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('The engagement')
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('All spaces')
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  // "Client records" holds children -- it renders as a region frame, not
  // a leaf note. Its own preview children are separate React Flow
  // nodes anchored inside its frame (parentId + extent:'parent'), not
  // DOM descendants of the frame's own element.
  const exampleArea = groupCard(page, 'Client records')
  await expect(exampleArea).toBeVisible()
  await expect(noteCard(page, 'Jordan Reyes')).toBeVisible()
  await expect(noteCard(page, 'Discovery workstream')).toBeVisible()
  await expect(noteCard(page, 'Scratchpad')).toBeVisible()

  // The header always drills; a click on the frame's own body follows
  // the uniform click model instead (select, then commit-to-zoom).
  await exampleArea.getByTestId('atlas-group-header').click()
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Client records')
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('The engagement')
  await expect(noteCard(page, 'Jordan Reyes')).toBeVisible()
  await expect(noteCard(page, 'Statement of work')).toBeVisible()

  // Explicit back: the "The engagement" crumb returns to the
  // auto-entered root (the "All spaces" crumb also reaches one level
  // further, covered by the next test).
  await clickBreadcrumbSegment(page, page.getByTestId('atlas-breadcrumb').getByText('The engagement', { exact: true }), 'The engagement')
  await expect(page.getByTestId('atlas-breadcrumb')).not.toContainText('Client records')
  await expect(exampleArea).toBeVisible()
})

test('creating a sibling of the auto-entered root populates the "All spaces" meta level with two real root cards', async ({ page }) => {
  const title = 'ZzE2eAtlasSecondRoot'
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(atlasView(page)).toBeVisible()
  // The crumb is already visible even with one root card (goal 0221);
  // this test's own value is the meta level actually HOLDING a second
  // root once "Add beside" creates one, not the crumb's own visibility.
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('All spaces')

  // "Add beside" from the auto-entered root creates a SECOND root card
  // (a sibling of "The engagement", ParentID "") -- the only path a second
  // root card can be created through.
  // Element-relative position clear of cards, tray, and minimap.
  await page.getByTestId('atlas-board').click({ button: 'right', position: { x: 180, y: 420 } })
  await page.getByText('New space…', { exact: true }).click()
  await selectKind(page, ATLAS_KIND_TOPIC, 'atlas-create-kind')
  await page.getByTestId('atlas-create-title').fill(title)
  await page.getByRole('button', { name: 'Create' }).click()

  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('All spaces')
  await page.getByTestId('atlas-breadcrumb').getByText('All spaces', { exact: true }).click()
  const myRoot = groupCard(page, 'The engagement')
  await expect(myRoot).toBeVisible()
  const newRootCard = groupCard(page, title).or(noteCard(page, title))
  await expect(newRootCard).toBeVisible()

  // Cleanup: delete the second root card so it doesn't leak into every
  // later test in this file/worker (testing.md's within-file cleanup
  // discipline) -- back down to one root card, egocentric-root
  // auto-entry resolves straight back into "The engagement"; the crumb
  // stays visible regardless (goal 0221). A childless new root renders
  // as a plain note card.
  await openCard(page, noteCard(page, title))
  const rootOverlay = page.locator('[data-component="atlas-card-overlay"]')
  await deleteViaPageMenu(page, rootOverlay)
  await expect(newRootCard).not.toBeVisible()
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('All spaces')
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('The engagement')
})

test('the note card front shows kind/title/note/file-tag/presence chips; the page shows source/link details', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await groupCard(page, 'Client records').getByTestId('atlas-group-header').click()
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Client records')

  const charter = noteCard(page, 'Statement of work')
  await expect(charter).toBeVisible()
  await expect(charter.getByTestId('atlas-note-file-tag')).toHaveText('URL')
  await expect(charter.getByTestId('atlas-note-links-chip')).toBeVisible()

  const ada = noteCard(page, 'Jordan Reyes')
  await expect(ada.getByTestId('atlas-note-leaf-chip')).toBeVisible()
  await expect(ada.getByTestId('atlas-note-links-chip')).toHaveText('2 links')

  // Source/link detail relocated onto the card's own page (goal 0106
  // contract item 1 -- the flip's back face retired).
  await openCard(page, charter)
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay.getByTestId('atlas-page-meta-source')).toContainText('example.com')
  await page.keyboard.press('Escape')
  await expect(overlay).not.toBeVisible()
})

test('clicking a card selects it (replacing any prior selection) without moving the board; Escape clears the selection', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  const getting = noteCard(page, 'Discovery workstream')
  const scratchpad = noteCard(page, 'Scratchpad')
  const boardBefore = await page.getByTestId('atlas-board').boundingBox()

  const gettingWrapper = page.locator('.react-flow__node.selected').filter({ has: getting })
  const scratchpadWrapper = page.locator('.react-flow__node.selected').filter({ has: scratchpad })

  await getting.click()
  await expect(gettingWrapper).toHaveCount(1)

  // A plain click on a DIFFERENT card replaces the selection -- never
  // pops a surface, never leaves both selected (goal 0102's gesture
  // table).
  await scratchpad.click()
  await expect(scratchpadWrapper).toHaveCount(1)
  await expect(gettingWrapper).toHaveCount(0)

  const boardAfter = await page.getByTestId('atlas-board').boundingBox()
  expect(boardAfter).toEqual(boardBefore)

  await page.keyboard.press('Escape')
  await expect(scratchpadWrapper).toHaveCount(0)
})

test('create a child card, edit + persist it via the card page, then delete it', async ({ page }) => {
  const title = 'ZzE2eAtlasChildCard'
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  // Sibling-vs-child is always an explicit choice -- "Add inside this
  // card" lands the new card as a CHILD of the currently viewed space.
  await createCardViaTray(page, title, { kindID: ATLAS_KIND_TOPIC })

  const newCard = noteCard(page, title)
  await expect(newCard).toBeVisible()

  await openCard(page, newCard)
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay).toBeVisible()
  await fillMarkdownNote(page, 'atlas-page-note', 'A note written by the e2e suite.')
  await clickOutsideNoteEditor(overlay)
  await expect(overlay.getByTestId('atlas-page-saved-tick')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(overlay).not.toBeVisible()

  await openCard(page, newCard)
  await expect(page.getByTestId('atlas-page-note-rendered')).toContainText('A note written by the e2e suite.')

  // Cleanup: delete the card this test created (testing.md's
  // within-file cleanup discipline).
  await deleteViaPageMenu(page, overlay)
  await expect(newCard).not.toBeVisible()
})

test('the perspective switcher\'s Hide kinds section hides a kind within a space', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await groupCard(page, 'Client records').getByTestId('atlas-group-header').click()
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Client records')

  const contactCard = noteCard(page, 'Jordan Reyes')
  await expect(contactCard).toBeVisible()

  await page.getByTestId('atlas-perspective-switcher-open').click()
  await expect(page.getByTestId('atlas-perspective-switcher-popover')).toBeVisible()
  await page.getByRole('checkbox', { name: /Contact/ }).uncheck()
  await page.keyboard.press('Escape')

  await expect(contactCard).not.toBeVisible()

  // Restore: re-show the kind so the space's lens doesn't leak into a
  // later test in this same file/worker.
  await page.getByTestId('atlas-perspective-switcher-open').click()
  await page.getByRole('checkbox', { name: /Contact/ }).check()
  await page.keyboard.press('Escape')
  await expect(contactCard).toBeVisible()
})

test('hiding a kind never removes a region frame of that kind -- containment is a role, not a type', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const exampleArea = groupCard(page, 'Client records')
  await expect(exampleArea).toBeVisible()
  const gettingStarted = noteCard(page, 'Discovery workstream')
  await expect(gettingStarted).toBeVisible()

  // "Client records" is itself a Topic-kind card. Hiding Topic must hide
  // the Topic LEAVES (Discovery workstream, Scratchpad) but keep the area
  // frame -- a place holding cards stays on the board regardless of
  // its own kind.
  await page.getByTestId('atlas-perspective-switcher-open').click()
  await page.getByRole('checkbox', { name: /Topic/ }).uncheck()
  await page.keyboard.press('Escape')

  await expect(gettingStarted).not.toBeVisible()
  await expect(noteCard(page, 'Scratchpad')).not.toBeVisible()
  await expect(exampleArea).toBeVisible()

  // Restore for later tests in this worker.
  await page.getByTestId('atlas-perspective-switcher-open').click()
  await page.getByRole('checkbox', { name: /Topic/ }).check()
  await page.keyboard.press('Escape')
  await expect(gettingStarted).toBeVisible()
})

test('a sibling card created into a Free-mode space lands clear of both leaf notes and region frames', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  // "Add beside" is relative to the CURRENTLY VIEWED card -- drill into
  // "Client records" first so the new card lands as ITS sibling (a child
  // of "The engagement", alongside "Discovery workstream"/"Scratchpad"), not as a
  // second ROOT card (a sibling of "The engagement" itself, invisible on this
  // board).
  const exampleArea = groupCard(page, 'Client records')
  await expect(exampleArea).toBeVisible()
  await exampleArea.getByTestId('atlas-group-header').click()
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Client records')

  // Placement decides containment (goal 0139): a "sibling of the
  // viewed area" is just a create at the parent level -- navigate up,
  // then create with the tray.
  const title = 'ZzE2eAtlasSiblingCard'
  await clickBreadcrumbSegment(page, page.getByTestId('atlas-breadcrumb').getByText('The engagement', { exact: true }), 'The engagement')
  await createCardViaTray(page, title, { kindID: ATLAS_KIND_TOPIC })
  const newCard = noteCard(page, title)
  await expect(newCard).toBeVisible()

  // The new card must clear every existing sibling's actual rendered
  // footprint -- a region frame's own box is far larger than a bare
  // note card's, exactly the geometry findFreeDropPosition/
  // computeGroupFrameLayout must account for together (regression:
  // the seeded "Discovery workstream"/"Scratchpad" Free-mode positions
  // once landed underneath "Client records"'s own expanded frame).
  const siblings = [exampleArea, noteCard(page, 'Discovery workstream'), noteCard(page, 'Scratchpad')]
  for (const sibling of siblings) {
    const [boxA, boxB] = await Promise.all([sibling.boundingBox(), newCard.boundingBox()])
    if (!boxA || !boxB) throw new Error('expected both bounding boxes to be measurable')
    const overlaps =
      boxA.x < boxB.x + boxB.width && boxA.x + boxA.width > boxB.x && boxA.y < boxB.y + boxB.height && boxA.y + boxA.height > boxB.y
    expect(overlaps).toBe(false)
  }

  // Cleanup (testing.md's within-file discipline).
  await openCard(page, newCard)
  const siblingOverlay = page.locator('[data-component="atlas-card-overlay"]')
  await deleteViaPageMenu(page, siblingOverlay)
  await expect(newCard).not.toBeVisible()
})

test('a seeded link between a top-level card and a region frame\'s own child renders as a drawn edge', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  // "Discovery workstream" (top-level) links to "Jordan Reyes" (rendered
  // inside "Client records"'s own frame, one nesting level deep) --
  // both endpoints are on this board, so the edge must draw across
  // the frame boundary.
  await expect(page.locator('.react-flow__edge')).not.toHaveCount(0)
})

test('exporting the atlas graph downloads a portable JSON bundle with the seeded content', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(atlasView(page)).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await openToolbarAction(page, 'atlas-export')
  await page.getByTestId('atlas-export-json').click()
  const download = await downloadPromise
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8'))

  expect(parsed.schema).toBe('mill://schema/atlas/v1')
  expect(Array.isArray(parsed.cards)).toBe(true)
  expect(parsed.cards.some((c: { title?: string }) => c.title === 'The engagement')).toBe(true)
})

test('exporting the viewed board downloads a .drawio file with its own cells', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(atlasView(page)).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await openToolbarAction(page, 'atlas-export')
  await page.getByTestId('atlas-export-drawio').click()
  const download = await downloadPromise
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  const xml = Buffer.concat(chunks).toString('utf-8')

  expect(xml).toContain('<mxfile')
  expect(xml).toContain('<mxGraphModel')
  // The app auto-navigates into the single seeded root space ("The
  // engagement") on load -- the exported board is what's actually
  // RENDERED, its children, not the container card holding them.
  expect(xml).toContain('Client records')
  expect(xml).toContain('Discovery workstream')
})

test('Update now on the seeded mirror card runs its workflow through the normal gate and shows a synced receipt live', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await groupCard(page, 'Client records').getByTestId('atlas-group-header').click()
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Client records')

  const charterCard = noteCard(page, 'Statement of work')
  await expect(charterCard).toBeVisible()
  await openCard(page, charterCard)
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay).toBeVisible()
  await expect(overlay.getByTestId('atlas-overlay-update-now')).toBeVisible()

  await overlay.getByTestId('atlas-overlay-update-now').click()

  // The card's seeded RefreshWorkflowID (example-child-echo-workflow)
  // is deterministic, no clipboard/network -- it runs to SUCCESS
  // synchronously, so both the receipt run id and its status, and the
  // synced timestamp, appear live without a reload.
  await expect(overlay.getByTestId('atlas-overlay-receipt-run')).toBeVisible()
  await expect(overlay.getByTestId('atlas-overlay-receipt-status')).toContainText('SUCCESS')
  await expect(overlay.getByText(/Last synced/)).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(overlay).not.toBeVisible()
})

test('Quick Panel finds a seeded Atlas card by title', async ({ page }) => {
  const mainPage = await page.context().newPage()
  try {
    await mainPage.goto('/')
    await mainPage.getByRole('link', { name: 'Atlas' }).click()
    await expect(atlasView(mainPage)).toBeVisible()

    await page.goto('/#/quickpanel')
    const search = page.getByRole('combobox', { name: 'Quick Panel search' })
    await expect(search).toBeFocused()
    await search.fill('Jordan Reyes')

    const option = page.getByRole('option', { name: /Jordan Reyes/ })
    await expect(option).toBeVisible()
  } finally {
    await mainPage.close()
  }
})
