import { test, expect } from './fixtures/server'
import { deleteViaPageMenu } from './fixtures/atlasPage'
import { ATLAS_KIND_TOPIC, selectKind } from './fixtures/kindPicker'
import { openViaFlip } from './fixtures/atlasBoard'

// Exercises the Atlas surface's one-map board (docs/adr/0038,
// goal 0072 slice A: AtlasShelves retired, every level renders through
// AtlasBoard) over real Go bindings (Wails3 server mode): the seeded
// root/My space space (Example area, Getting started, Scratchpad)
// proves auto-entry, drill via a region frame's own header, the flip-
// in-place engagement (front glance -> back working context -> Open),
// the explicit sibling-vs-child create flow, the per-space lens, and
// Quick Panel's card search -- the same seeded-example-is-the-proof
// pattern every other e2e spec in this suite follows. Seeded names
// ("My space", "Example area", "Getting started", "Scratchpad",
// "Contact", "Ada Lovelace") are used here to assert against the real
// seed (.claude/rules/testing.md: fine in e2e specs, never in
// frontend/src). With exactly one seeded root card, the surface
// auto-enters it -- every test below already lands on "My space"
// without needing to click it, and the "All spaces" meta-level crumb
// is absent unless a test explicitly creates a second root card. The
// share (goal 0063) and projection (goal 0064) test groups live in
// sibling files, atlas-share.spec.ts and atlas-projections.spec.ts --
// split out to stay under architecture.md's 500-line convention, same
// pattern composition.spec.ts/composition-canvas-interactions.spec.ts
// already established.

function atlasView(page: import('@playwright/test').Page) {
  return page.getByTestId('atlas-view')
}

// Precise per-card matching: a plain hasText substring filter is
// unreliable here since a card's own BACK face can legitimately
// contain another card's title (its own "<kind> -> <other title>"
// link row) -- aria-label carries the exact title instead.
function noteCard(page: import('@playwright/test').Page, title: string) {
  return page.locator(`[data-testid="atlas-note-card"][aria-label="Flip ${title}"]`)
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

test('the seeded single root auto-enters "My space"; drilling into a region frame via its header works across both board modes', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(atlasView(page)).toBeVisible()

  // Auto-entry (ADR-0038's egocentric-root principle): with exactly one
  // root card, the surface opens already drilled into it -- "My space"
  // IS the top, so the breadcrumb starts there with no synthetic
  // "All spaces" crumb, and its content is visible immediately, with
  // no click required.
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('My space')
  await expect(page.getByTestId('atlas-breadcrumb')).not.toContainText('All spaces')
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  // "Example area" holds children -- it renders as a region frame, not
  // a flippable leaf note. Its own preview children are separate React
  // Flow nodes anchored inside its frame (parentId + extent:'parent'),
  // not DOM descendants of the frame's own element.
  const exampleArea = groupCard(page, 'Example area')
  await expect(exampleArea).toBeVisible()
  await expect(noteCard(page, 'Ada Lovelace')).toBeVisible()
  await expect(noteCard(page, 'Getting started')).toBeVisible()
  await expect(noteCard(page, 'Scratchpad')).toBeVisible()

  // The header is the only drill affordance on a region frame -- its
  // own body never flips.
  await exampleArea.getByTestId('atlas-group-header').click()
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Example area')
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('My space')
  await expect(noteCard(page, 'Ada Lovelace')).toBeVisible()
  await expect(noteCard(page, 'Project charter')).toBeVisible()

  // Explicit back: the "My space" crumb (there is no "All spaces" one
  // to fall back to further) returns to the auto-entered root.
  await page.getByTestId('atlas-breadcrumb').getByText('My space', { exact: true }).click()
  await expect(page.getByTestId('atlas-breadcrumb')).not.toContainText('Example area')
  await expect(exampleArea).toBeVisible()
})

test('creating a sibling of the auto-entered root surfaces the "All spaces" meta level, reachable via breadcrumb', async ({ page }) => {
  const title = 'ZzE2eAtlasSecondRoot'
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(atlasView(page)).toBeVisible()
  await expect(page.getByTestId('atlas-breadcrumb')).not.toContainText('All spaces')

  // "Add beside" from the auto-entered root creates a SECOND root card
  // (a sibling of "My space", ParentID "") -- the only path a second
  // root card can be created through, and the one that must surface
  // the meta level once it exists.
  await page.getByTestId('atlas-add-button').click()
  await page.getByTestId('atlas-add-sibling').click()
  await selectKind(page, ATLAS_KIND_TOPIC, 'atlas-create-kind')
  await page.getByTestId('atlas-create-title').fill(title)
  await page.getByRole('button', { name: 'Create' }).click()

  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('All spaces')
  await page.getByTestId('atlas-breadcrumb').getByText('All spaces', { exact: true }).click()
  const myRoot = groupCard(page, 'My space')
  await expect(myRoot).toBeVisible()
  const newRootCard = groupCard(page, title).or(noteCard(page, title))
  await expect(newRootCard).toBeVisible()

  // Cleanup: delete the second root card so it doesn't leak the meta
  // level into every later test in this file/worker (testing.md's
  // within-file cleanup discipline) -- back down to one root card, the
  // meta level (and its crumb) stop existing again. A childless new
  // root renders as a plain note card.
  await openViaFlip(noteCard(page, title))
  const rootOverlay = page.locator('[data-component="atlas-card-overlay"]')
  await deleteViaPageMenu(page, rootOverlay)
  await expect(newRootCard).not.toBeVisible()
  await expect(page.getByTestId('atlas-breadcrumb')).not.toContainText('All spaces')
})

test('the note card front shows kind/title/note/file-tag/presence chips; the back shows source/link/Open', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await groupCard(page, 'Example area').getByTestId('atlas-group-header').click()
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Example area')

  const charter = noteCard(page, 'Project charter')
  await expect(charter).toBeVisible()
  await expect(charter.getByTestId('atlas-note-file-tag')).toHaveText('URL')
  await expect(charter.getByTestId('atlas-note-links-chip')).toBeVisible()

  const ada = noteCard(page, 'Ada Lovelace')
  await expect(ada.getByTestId('atlas-note-leaf-chip')).toBeVisible()
  await expect(ada.getByTestId('atlas-note-links-chip')).toHaveText('2 links')

  await charter.click()
  await expect(charter).toHaveAttribute('data-flipped', 'true')
  await expect(charter.getByTestId('atlas-note-card-back')).toContainText('source: example.com')
  await expect(charter.getByTestId('atlas-note-open')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(charter).toHaveAttribute('data-flipped', 'false')
})

test('clicking a card flips it in place without moving the board; a second card unflips the first; Escape unflips', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  const getting = noteCard(page, 'Getting started')
  const scratchpad = noteCard(page, 'Scratchpad')
  const boardBefore = await page.getByTestId('atlas-board').boundingBox()

  await getting.click()
  await expect(getting).toHaveAttribute('data-flipped', 'true')
  await expect(getting.getByTestId('atlas-note-card-back')).toContainText('flip side')

  // Flipping a second card unflips the first -- exactly one card
  // flipped at a time.
  await scratchpad.click()
  await expect(scratchpad).toHaveAttribute('data-flipped', 'true')
  await expect(getting).toHaveAttribute('data-flipped', 'false')

  const boardAfter = await page.getByTestId('atlas-board').boundingBox()
  expect(boardAfter).toEqual(boardBefore)

  await page.keyboard.press('Escape')
  await expect(scratchpad).toHaveAttribute('data-flipped', 'false')
})

test('arrange is an action: dragging persists a position, Auto-arrange re-seats it (goal 0089)', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await groupCard(page, 'Example area').getByTestId('atlas-group-header').click()
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Example area')

  // No mode toggle anywhere -- the Auto-arrange BUTTON is present at
  // every level instead (positions are always sovereign).
  await expect(page.getByTestId('atlas-view-mode-toggle')).toHaveCount(0)
  const arrange = page.getByTestId('atlas-auto-arrange')
  await expect(arrange).toBeVisible()

  // One-shot arrange persists seats: click it, then a reload renders
  // the same FLOW positions (React Flow writes translate(x,y) in flow
  // coords on the node element -- camera-independent, unlike
  // boundingBox, which shifts with fitView's post-reload camera).
  await arrange.click()
  const adaNode = page.locator('.react-flow__node').filter({ has: page.locator('[aria-label="Flip Ada Lovelace"]') })
  await expect(adaNode).toBeVisible()
  let before = ''
  await expect.poll(async () => {
    before = (await adaNode.evaluate((el) => (el as HTMLElement).style.transform)) ?? ''
    return before
  }).toContain('translate')
  await page.reload()
  await expect(atlasView(page)).toBeVisible()
  await groupCard(page, 'Example area').getByTestId('atlas-group-header').click()
  await expect(adaNode).toBeVisible()
  await expect.poll(async () => adaNode.evaluate((el) => (el as HTMLElement).style.transform), { timeout: 10_000 }).toBe(before)
})

test('create a child card, edit + persist it via the flip-then-Open overlay, then delete it', async ({ page }) => {
  const title = 'ZzE2eAtlasChildCard'
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  // Sibling-vs-child is always an explicit choice -- "Add inside this
  // card" lands the new card as a CHILD of the currently viewed space.
  await page.getByTestId('atlas-add-button').click()
  await page.getByTestId('atlas-add-child').click()
  await selectKind(page, ATLAS_KIND_TOPIC, 'atlas-create-kind')
  await page.getByTestId('atlas-create-title').fill(title)
  await page.getByRole('button', { name: 'Create' }).click()

  const newCard = noteCard(page, title)
  await expect(newCard).toBeVisible()

  await openViaFlip(newCard)
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay).toBeVisible()
  await overlay.getByTestId('atlas-page-note').fill('A note written by the e2e suite.')
  await overlay.getByTestId('atlas-page-note').blur()
  await expect(overlay.getByTestId('atlas-page-saved-tick')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(overlay).not.toBeVisible()

  await openViaFlip(newCard)
  await expect(page.getByTestId('atlas-page-note')).toHaveValue('A note written by the e2e suite.')

  // Cleanup: delete the card this test created (testing.md's
  // within-file cleanup discipline).
  await deleteViaPageMenu(page, overlay)
  await expect(newCard).not.toBeVisible()
})

test('the lens hides a kind within a space', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await groupCard(page, 'Example area').getByTestId('atlas-group-header').click()
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Example area')

  const contactCard = noteCard(page, 'Ada Lovelace')
  await expect(contactCard).toBeVisible()

  await page.getByTestId('atlas-lens-open').click()
  await expect(page.locator('[data-component="atlas-lens-dialog"]')).toBeVisible()
  await page.getByRole('checkbox', { name: /Contact/ }).uncheck()
  await page.keyboard.press('Escape')

  await expect(contactCard).not.toBeVisible()

  // Restore: re-show the kind so the space's lens doesn't leak into a
  // later test in this same file/worker.
  await page.getByTestId('atlas-lens-open').click()
  await page.getByRole('checkbox', { name: /Contact/ }).check()
  await page.keyboard.press('Escape')
  await expect(contactCard).toBeVisible()
})

test('lens-hiding a kind never removes a region frame of that kind -- containment is a role, not a type', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const exampleArea = groupCard(page, 'Example area')
  await expect(exampleArea).toBeVisible()
  const gettingStarted = noteCard(page, 'Getting started')
  await expect(gettingStarted).toBeVisible()

  // "Example area" is itself a Topic-kind card. Hiding Topic must hide
  // the Topic LEAVES (Getting started, Scratchpad) but keep the area
  // frame -- a place holding cards stays on the board regardless of
  // its own kind.
  await page.getByTestId('atlas-lens-open').click()
  await page.getByRole('checkbox', { name: /Topic/ }).uncheck()
  await page.keyboard.press('Escape')

  await expect(gettingStarted).not.toBeVisible()
  await expect(noteCard(page, 'Scratchpad')).not.toBeVisible()
  await expect(exampleArea).toBeVisible()

  // Restore for later tests in this worker.
  await page.getByTestId('atlas-lens-open').click()
  await page.getByRole('checkbox', { name: /Topic/ }).check()
  await page.keyboard.press('Escape')
  await expect(gettingStarted).toBeVisible()
})

test('a sibling card created into a Free-mode space lands clear of both leaf notes and region frames', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  // "Add beside" is relative to the CURRENTLY VIEWED card -- drill into
  // "Example area" first so the new card lands as ITS sibling (a child
  // of "My space", alongside "Getting started"/"Scratchpad"), not as a
  // second ROOT card (a sibling of "My space" itself, invisible on this
  // board).
  const exampleArea = groupCard(page, 'Example area')
  await expect(exampleArea).toBeVisible()
  await exampleArea.getByTestId('atlas-group-header').click()
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Example area')

  const title = 'ZzE2eAtlasSiblingCard'
  await page.getByTestId('atlas-add-button').click()
  await page.getByTestId('atlas-add-sibling').click()
  await selectKind(page, ATLAS_KIND_TOPIC, 'atlas-create-kind')
  await page.getByTestId('atlas-create-title').fill(title)
  await page.getByRole('button', { name: 'Create' }).click()

  await page.getByTestId('atlas-breadcrumb').getByText('My space', { exact: true }).click()
  const newCard = noteCard(page, title)
  await expect(newCard).toBeVisible()

  // The new card must clear every existing sibling's actual rendered
  // footprint -- a region frame's own box is far larger than a bare
  // note card's, exactly the geometry findFreeDropPosition/
  // computeGroupFrameLayout must account for together (regression:
  // the seeded "Getting started"/"Scratchpad" Free-mode positions
  // once landed underneath "Example area"'s own expanded frame).
  const siblings = [exampleArea, noteCard(page, 'Getting started'), noteCard(page, 'Scratchpad')]
  for (const sibling of siblings) {
    const [boxA, boxB] = await Promise.all([sibling.boundingBox(), newCard.boundingBox()])
    if (!boxA || !boxB) throw new Error('expected both bounding boxes to be measurable')
    const overlaps =
      boxA.x < boxB.x + boxB.width && boxA.x + boxA.width > boxB.x && boxA.y < boxB.y + boxB.height && boxA.y + boxA.height > boxB.y
    expect(overlaps).toBe(false)
  }

  // Cleanup (testing.md's within-file discipline).
  await openViaFlip(newCard)
  const siblingOverlay = page.locator('[data-component="atlas-card-overlay"]')
  await deleteViaPageMenu(page, siblingOverlay)
  await expect(newCard).not.toBeVisible()
})

test('a seeded link between a top-level card and a region frame\'s own child renders as a drawn edge', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  // "Getting started" (top-level) links to "Ada Lovelace" (rendered
  // inside "Example area"'s own frame, one nesting level deep) --
  // both endpoints are on this board, so the edge must draw across
  // the frame boundary.
  await expect(page.locator('.react-flow__edge')).not.toHaveCount(0)
})

test('exporting the atlas graph downloads a portable JSON bundle with the seeded content', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(atlasView(page)).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await page.getByTestId('atlas-export').click()
  const download = await downloadPromise
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8'))

  expect(parsed.schema).toBe('mill://schema/atlas/v1')
  expect(Array.isArray(parsed.cards)).toBe(true)
  expect(parsed.cards.some((c: { title?: string }) => c.title === 'My space')).toBe(true)
})

test('Update now on the seeded mirror card runs its workflow through the normal gate and shows a synced receipt live', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await groupCard(page, 'Example area').getByTestId('atlas-group-header').click()
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Example area')

  const charterCard = noteCard(page, 'Project charter')
  await expect(charterCard).toBeVisible()
  await openViaFlip(charterCard)
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

test('the lens depth toggle persists server-side across a reload', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await groupCard(page, 'Example area').getByTestId('atlas-group-header').click()
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Example area')

  await page.getByTestId('atlas-lens-open').click()
  await expect(page.locator('[data-component="atlas-lens-dialog"]')).toBeVisible()
  await page.getByRole('button', { name: 'Peek into children' }).click()
  await page.keyboard.press('Escape')

  await page.reload()
  await expect(atlasView(page)).toBeVisible()
  await groupCard(page, 'Example area').getByTestId('atlas-group-header').click()
  await page.getByTestId('atlas-lens-open').click()
  await expect(page.getByRole('button', { name: 'Peek into children', pressed: true })).toBeVisible()
  await page.keyboard.press('Escape')

  // Restore: clear the peek toggle so it doesn't leak into a later test
  // in this same file/worker (testing.md's within-file cleanup rule).
  await page.getByTestId('atlas-lens-open').click()
  await page.getByRole('button', { name: 'This level only' }).click()
  await page.keyboard.press('Escape')
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
    await search.fill('Ada Lovelace')

    const option = page.getByRole('option', { name: /Ada Lovelace/ })
    await expect(option).toBeVisible()
  } finally {
    await mainPage.close()
  }
})
