import { test, expect } from './fixtures/server'
import { boardPoint, dragBetween, nonSeededBoardObjects, nonSeededBoardObjectWrapper } from './fixtures/atlasBoard'
import { clickAtlasTrayTool } from './fixtures/atlasTray'
import { contextMenu } from './fixtures/contextMenu'
import { ATLAS_KIND_TOPIC, selectKind } from './fixtures/kindPicker'
import { waitForViewportStable } from './fixtures/animation'

// The pencil tool (goal 0169 slice 3, re-pointed by goal 0179 S1's own
// correction): drag-to-draw lands ink as a board-local BoardObject --
// NEVER a card, and NEVER a commit ceremony that interrupts drawing.
// Consecutive strokes each add another ink object without disarming
// the tool; a stroke never opens a page, never gets a title, and
// "Promote to card…" is the one explicit, one-way escape hatch out of
// board-local. Shared pool: every entity created here is deleted here.
//
// Real pointer-capture drag, not React Flow's own internal drag
// machinery (the class QUARANTINE.md's box-select/NodeResizer entries
// document as unreliable to synthesize): this hook is wired the exact
// same way the Area tool's own marquee draw is
// (onPointerDownCapture/MoveCapture/UpCapture on an ANCESTOR of React
// Flow's pane), which atlas-containment.spec.ts already proves
// reliably synthesizable via page.mouse -- dense intermediate moves,
// not React Flow's own delta-sampled drag tracking. boardPoint/
// dragBetween are the shared fixtures/atlasBoard.ts versions (this
// spec's own former local boardPoint copy was promoted there,
// testing.md's promotion rule).

function inkObjects(page: import('@playwright/test').Page) {
  return nonSeededBoardObjects(page, 'ink')
}

test('dragging the pencil across the board lands ink, never a card, and the tool stays armed for the next stroke', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  const pencilTool = page.getByTestId('atlas-tray-pencil')
  await clickAtlasTrayTool(page, 'atlas-tray-pencil')
  await expect(pencilTool).toHaveAttribute('data-armed', 'true')
  await expect(page.getByTestId('atlas-pencil-style-picker')).toBeVisible()

  await dragBetween(page, await boardPoint(board, 0.05, 0.1), await boardPoint(board, 0.15, 0.2))

  const ink = inkObjects(page)
  await expect(ink).toHaveCount(1)
  // The rule, absolute: drawing never creates a card the user didn't
  // explicitly ask for -- checked against the title a stroke would
  // have produced had it (wrongly) landed as a card, not a blanket
  // zero (the seeded example space already carries its own cards).
  await expect(page.getByTestId('atlas-note-card').filter({ hasText: 'Sketch' })).toHaveCount(0)

  // Drag-to-draw is a sticky tool (unlike Area's own one-placement-
  // per-arming rule): completing a stroke never disarms it, so a
  // second stroke draws immediately and lands as its OWN object --
  // consecutive strokes never merge or interrupt each other.
  await expect(pencilTool).toHaveAttribute('data-armed', 'true')
  await dragBetween(page, await boardPoint(board, 0.3, 0.1), await boardPoint(board, 0.4, 0.2))
  await expect(ink).toHaveCount(2)

  // Promote to card (explicit, one-way): the baked SVG stroke becomes
  // a real mirror-image card.
  await ink.first().click({ button: 'right' })
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await menu.getByText('Promote to card…', { exact: true }).click()
  const popover = page.getByTestId('atlas-placement-popover')
  await expect(popover).toBeVisible()
  await expect(popover.getByTestId('atlas-placement-title')).toHaveValue('Sketch')
  await selectKind(popover, ATLAS_KIND_TOPIC)
  await popover.getByTestId('atlas-placement-submit').click()
  await expect(popover).not.toBeVisible()
  await expect(ink).toHaveCount(1)
  const card = page.getByTestId('atlas-note-card').filter({ hasText: 'Sketch' })
  await expect(card).toBeVisible()
  await expect(card.getByText('IMG')).toBeVisible()

  // Clean up: the promoted card, then the remaining ink object.
  await card.click({ button: 'right' })
  await expect(menu).toBeVisible()
  await menu.getByText('Delete', { exact: true }).click()
  await expect(card).toHaveCount(0)

  await ink.click({ button: 'right' })
  await expect(menu).toBeVisible()
  await menu.getByText('Delete', { exact: true }).click()
  await expect(ink).toHaveCount(0)
})

test('the pencil\'s colour choice survives a disarm/re-arm cycle and seeds the next stroke', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  await clickAtlasTrayTool(page, 'atlas-tray-pencil')
  const picker = page.getByTestId('atlas-pencil-style-picker')
  await expect(picker).toBeVisible()

  // The default colour is the first swatch -- pick a DIFFERENT one so
  // a regression back to the default would be visible.
  const chosenSwatch = picker.getByTestId('atlas-pencil-color-da3633')
  await expect(chosenSwatch).toHaveAttribute('data-selected', 'false')
  await chosenSwatch.click()
  await expect(chosenSwatch).toHaveAttribute('data-selected', 'true')

  const ink = inkObjects(page)
  await dragBetween(page, await boardPoint(board, 0.05, 0.1), await boardPoint(board, 0.15, 0.2))
  await expect(ink).toHaveCount(1)

  // Disarm, then re-arm: the style picker REMOUNTS (AnchoredOverlay
  // unmounts its children while closed) -- the swatch selection
  // surviving this proves it lives in the ephemeral store, not
  // per-mount component state.
  await clickAtlasTrayTool(page, 'atlas-tray-pencil')
  await expect(picker).not.toBeVisible()
  await clickAtlasTrayTool(page, 'atlas-tray-pencil')
  await expect(picker).toBeVisible()
  await expect(picker.getByTestId('atlas-pencil-color-da3633')).toHaveAttribute('data-selected', 'true')

  await dragBetween(page, await boardPoint(board, 0.3, 0.1), await boardPoint(board, 0.4, 0.2))
  await expect(ink).toHaveCount(2)

  for (let i = 0; i < 2; i++) {
    await ink.first().click({ button: 'right' })
    const menu = contextMenu(page)
    await expect(menu).toBeVisible()
    await menu.getByText('Delete', { exact: true }).click()
  }
  await expect(ink).toHaveCount(0)
})

// Goal 0208 defect 1 (traced): the pane's own crosshair cursor never
// reached a board object, since AtlasBoardObjectNode.module.css's
// `.object { cursor: pointer }` sits on the element itself, which
// always wins over an ancestor rule regardless of that rule's
// specificity. The armed cursor must win at the exact surface the
// owner is pointing at, then hand it back the instant the tool
// disarms.
test('the armed pencil cursor reads crosshair over a card, and the card\'s own pointer cursor returns once disarmed', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  const card = page.getByTestId('atlas-note-card').first()
  await expect(card).toBeVisible()
  await card.hover()
  expect(await card.evaluate((el) => getComputedStyle(el).cursor)).toBe('pointer')

  const pencilTool = page.getByTestId('atlas-tray-pencil')
  await clickAtlasTrayTool(page, 'atlas-tray-pencil')
  await expect(pencilTool).toHaveAttribute('data-armed', 'true')
  await card.hover()
  expect(await card.evaluate((el) => getComputedStyle(el).cursor)).toBe('crosshair')

  await clickAtlasTrayTool(page, 'atlas-tray-pencil')
  // The Annotate group closes along with the disarm (goal 0224:
  // nothing armed inside it left open would swallow a LATER, unrelated
  // Escape press) -- pencil's own button leaves the DOM.
  await expect(pencilTool).not.toBeVisible()
  await card.hover()
  expect(await card.evaluate((el) => getComputedStyle(el).cursor)).toBe('pointer')
})

// Goal 0208 defect 5: verified live against unmodified code that
// useAtlasCreation.ts's own Escape listener already disarms ANY tool
// unconditionally -- this pins that behaviour as a committed test
// rather than leaving it proven only by hand, and extends 0199's own
// "no Escape anywhere" proof (atlas-pencil-tool.spec.ts's file-level
// diff) with the one continuous-tool case it never covered.
test('Escape disarms the pencil back to select', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  const pencilTool = page.getByTestId('atlas-tray-pencil')
  await clickAtlasTrayTool(page, 'atlas-tray-pencil')
  await expect(pencilTool).toHaveAttribute('data-armed', 'true')

  await page.keyboard.press('Escape')
  await expect(pencilTool).not.toBeVisible()
  await expect(board).toHaveAttribute('data-armed', 'false')
})

// Goal 0208 defect 2: React Flow's own panActivationKeyCode ('Space',
// its default, adopted rather than hand-rolled) re-enables pane
// panning the instant Space is held, once this board's own capture-
// phase pointer handlers step aside for it (useAtlasPanActivation.ts).
//
// fixme (goal 0224, QUARANTINE.md's own entry has the full trace):
// arming Pencil via the Annotate group's two-step door (open the
// drawer, then click the tool inside it) leaves Space-to-pan
// completely inert for the rest of that arming -- `data-panning` and
// `.react-flow__pane`'s own 'draggable' class both read correctly
// throughout, but the viewport transform never moves a single pixel
// across a full drag. Confirmed NOT caused by focus-trap, focus-zone,
// spatial popover collision, cross-tool (table/image) interference, or
// timing -- every one of those was independently disabled/isolated and
// the regression persisted; arming the SAME tool via one direct click
// (no drawer) never reproduces it. Root cause not yet isolated inside
// Primer AnchoredOverlay / React Flow's own useKeyPress interaction.
test.fixme('holding Space pans the board without drawing while the pencil stays armed', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  const pencilTool = page.getByTestId('atlas-tray-pencil')
  await clickAtlasTrayTool(page, 'atlas-tray-pencil')
  await expect(pencilTool).toHaveAttribute('data-armed', 'true')

  const ink = inkObjects(page)
  const viewport = page.locator('.react-flow__viewport')
  const before = await viewport.evaluate((el) => el.style.transform)

  const box = await board.boundingBox()
  if (!box) throw new Error('board has no bounding box')
  await board.hover({ position: { x: box.width * 0.5, y: box.height * 0.5 } })
  await page.keyboard.down('Space')
  await expect(board).toHaveAttribute('data-panning', 'true')
  await expect(page.locator('.react-flow__pane')).toHaveClass(/draggable/)

  // Checked-drag helper (goal 0184), not raw page.mouse.* -- the START
  // point is re-verified reachable immediately before mouse.down() via
  // Playwright's own actionability pipeline; the free-form pan
  // destination has no owning element to check against, so it stays a
  // plain page point per dragBetween's own documented boundary.
  await dragBetween(page, { locator: board, position: { x: box.width * 0.5, y: box.height * 0.5 } }, { x: box.x + box.width * 0.65, y: box.y + box.height * 0.6 })
  await page.keyboard.up('Space')
  await expect(board).toHaveAttribute('data-panning', 'false')

  // The drag panned, it never drew.
  await expect(ink).toHaveCount(0)
  await expect.poll(() => viewport.evaluate((el) => el.style.transform)).not.toBe(before)
})

// Goal 0213: starting a new stroke ON TOP OF an existing one used to
// both select and drag the existing stroke while the new one drew,
// because stopping propagation on the capture-phase pointerdown
// silenced React Flow's own preventDefault() without replacing it --
// the suppressed browser compat mousedown still reached the node
// underneath and ran its native (d3-drag) drag. Pins the fixed
// property directly: an armed draw tool's gesture only draws, an
// existing node under it never moves and never gets selected.
test('starting a stroke on top of an existing one draws without selecting or dragging it', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()
  // The board's own initial fitView animates (goal 0080's interaction-race
  // class): every raw screen coordinate this test computes below must be
  // read AFTER that settles, or it's stale by the time it's used.
  await waitForViewportStable(board)

  await clickAtlasTrayTool(page, 'atlas-tray-pencil')
  const ink = inkObjects(page)

  // Stroke A: stays in the board's own TOP band, clear of the pencil's
  // own style picker popover, which occupies the lower-middle of the
  // viewport for as long as pencil stays armed (atlas-shape-tool.spec.ts's
  // own comment documents the same hazard for shape's picker).
  await dragBetween(page, await boardPoint(board, 0.05, 0.1), await boardPoint(board, 0.17, 0.2))
  await expect(ink).toHaveCount(1)
  // The node renders a placeholder until its mirror image loads, then
  // resizes to true dimensions (the same async settle the DOM-mutation
  // test below this one already waits out) -- any bounding box read
  // before this is stale by the time it's used.
  await expect(ink.first().locator('img')).toBeVisible()

  // A fixed ElementHandle, not a re-resolved Locator -- so every later
  // read below stays pinned to THIS specific DOM node regardless of
  // where a second ink object lands in document order (the same
  // pattern the DOM-mutation test below this one already uses).
  const strokeAWrapper = nonSeededBoardObjectWrapper(page, 'ink')
  const strokeAHandle = await strokeAWrapper.elementHandle()
  if (!strokeAHandle) throw new Error('stroke A node has no element handle')
  const strokeABox = await strokeAHandle.boundingBox()
  if (!strokeABox) throw new Error('stroke A node has no bounding box')
  const initialTransform = await strokeAHandle.evaluate((el) => (el as HTMLElement).style.transform)
  expect(await strokeAHandle.evaluate((el) => el.classList.contains('selected'))).toBe(false)

  // Stroke B starts directly ON TOP of stroke A's own box and drags
  // across it -- exactly the gesture the defect mishandled. Plain
  // {x,y} points (dragBetween's documented escape hatch): the start
  // point must land ON stroke A's own element on purpose, which an
  // owning-locator actionability check would fight.
  const startX = strokeABox.x + strokeABox.width * 0.5
  const startY = strokeABox.y + strokeABox.height * 0.5
  await dragBetween(page, { x: startX, y: startY }, { x: startX + 40, y: startY + 40 })
  await expect(ink).toHaveCount(2)

  // Stroke A never moved and was never selected.
  await expect.poll(() => strokeAHandle.evaluate((el) => (el as HTMLElement).style.transform)).toBe(initialTransform)
  expect(await strokeAHandle.evaluate((el) => el.classList.contains('selected'))).toBe(false)

  // Cleanup: stroke B is identified by exclusion (the ink node whose
  // own data-id isn't stroke A's, pinned the same fixed-handle way as
  // stroke A above) rather than by index, since document order isn't
  // guaranteed. Stroke B was dragged from stroke A's own center toward
  // increasing x/y, so B's own far (bottom-right) corner sits clear of
  // A's box and A's own top-left corner sits clear of B's -- each
  // click's position is read FRESH off its element's CURRENT bounding
  // box (Locator/ElementHandle.click resolves position at click time,
  // never off a coordinate captured earlier), so neither one can go
  // stale the way a raw page-coordinate click already proved flaky here.
  const strokeAID = await strokeAHandle.evaluate((el) => el.getAttribute('data-id'))
  // The has: needle stays descendant-only (nonSeededBoardObjectWrapper's
  // own comment explains why reusing `ink`'s full ancestor-prefixed
  // selector here would never match).
  const strokeBHandle = await page.locator(`.react-flow__node[data-id]:not([data-id="${strokeAID}"])`).filter({ has: page.locator('[data-testid="atlas-board-object"][data-object-kind="ink"]') }).elementHandle()
  if (!strokeBHandle) throw new Error('stroke B node has no element handle')
  const strokeBBox = await strokeBHandle.boundingBox()
  if (!strokeBBox) throw new Error('stroke B node has no bounding box')

  const menu = contextMenu(page)
  await strokeBHandle.click({ button: 'right', position: { x: strokeBBox.width - 5, y: strokeBBox.height - 5 } })
  await expect(menu).toBeVisible()
  await menu.getByText('Delete', { exact: true }).click()
  await expect(ink).toHaveCount(1)

  await strokeAHandle.click({ button: 'right', position: { x: 5, y: 5 } })
  await expect(menu).toBeVisible()
  await menu.getByText('Delete', { exact: true }).click()
  await expect(ink).toHaveCount(0)
})

// Goal 0208 defect 3, traced live: atlasStore.ts's refreshAtlas()
// refetches every board object on any commit, handing each one a
// fresh Payload reference even when unchanged; AtlasBoardObjectNode.tsx
// depended on that whole object, re-firing its mirror-content fetch
// (and the synchronous setSrc(null) ahead of it) for every ALREADY-
// rendered ink node on every later stroke's commit -- confirmed via a
// live MutationObserver showing the first stroke's own <img> mutating
// when a second, unrelated stroke committed. Pins the fixed property
// directly: zero DOM mutations on an untouched stroke's own object
// when a later one commits.
test('committing a second stroke causes no DOM mutation on the first stroke\'s own object', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  await clickAtlasTrayTool(page, 'atlas-tray-pencil')
  const ink = inkObjects(page)

  await dragBetween(page, await boardPoint(board, 0.05, 0.1), await boardPoint(board, 0.15, 0.2))
  await expect(ink).toHaveCount(1)
  await expect(ink.first().locator('img')).toBeVisible()

  await ink.first().evaluate((el) => {
    const w = window as unknown as { __atlas0208Mutations: MutationRecord[] }
    w.__atlas0208Mutations = []
    const observer = new MutationObserver((records) => w.__atlas0208Mutations.push(...records))
    observer.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] })
  })

  // Stays in the board's own TOP band, clear of the style picker's own
  // popover (atlas-shape-tool.spec.ts's own comment documents the same
  // hazard) -- a drag start point landing on that popover never
  // reaches the board's pointer-capture handler at all.
  await dragBetween(page, await boardPoint(board, 0.5, 0.1), await boardPoint(board, 0.6, 0.2))
  await expect(ink).toHaveCount(2)

  const mutationCount = await page.evaluate(() => (window as unknown as { __atlas0208Mutations: MutationRecord[] }).__atlas0208Mutations.length)
  expect(mutationCount, 'a later stroke\'s commit must not touch an already-rendered stroke\'s own DOM').toBe(0)

  for (let i = 0; i < 2; i++) {
    await ink.first().click({ button: 'right' })
    const menu = contextMenu(page)
    await expect(menu).toBeVisible()
    await menu.getByText('Delete', { exact: true }).click()
  }
  await expect(ink).toHaveCount(0)
})

// Goal 0230: reproduced live via per-frame MutationObserver + polled-
// cursor sampling through a full stroke. Two properties traced clean
// against the current gesture engine and found already correct --
// pinned here so a future overlay-slot change can't silently reopen
// either:
test('the armed pencil cursor stays crosshair for the whole drag, not just at rest', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()
  await waitForViewportStable(board)

  await clickAtlasTrayTool(page, 'atlas-tray-pencil')
  const ink = page.locator('[data-testid="atlas-board-object"][data-object-kind="ink"]')
  const pane = page.locator('.react-flow__pane')

  // Sampled after EVERY intermediate move, button still down -- the
  // whole active-drag window, not just the armed-but-idle state the
  // crosshair test above already covers.
  await dragBetween(
    page,
    await boardPoint(board, 0.05, 0.1),
    await boardPoint(board, 0.2, 0.25),
    undefined,
    async () => { await expect(pane).toHaveCSS('cursor', 'crosshair') },
  )

  await expect(ink).toHaveCount(1)
  await ink.first().click({ button: 'right' })
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await menu.getByText('Delete', { exact: true }).click()
  await expect(ink).toHaveCount(0)
})

test('the pencil\'s live preview mounts once per stroke, never remounting mid-drag', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()
  await waitForViewportStable(board)

  await clickAtlasTrayTool(page, 'atlas-tray-pencil')
  const ink = page.locator('[data-testid="atlas-board-object"][data-object-kind="ink"]')

  // The preview overlay's own element identity, captured as soon as
  // the first point lands -- a remount mid-stroke (rather than a prop
  // update on the same node) would swap this handle out from under a
  // held reference, which document.contains would then read as false.
  let previewHandle: import('@playwright/test').ElementHandle | null = null
  await dragBetween(
    page,
    await boardPoint(board, 0.05, 0.1),
    await boardPoint(board, 0.2, 0.25),
    undefined,
    async (step) => {
      if (step === 1) {
        previewHandle = await page.locator('[data-testid="atlas-pencil-preview"]').elementHandle()
        if (!previewHandle) throw new Error('pencil preview did not mount on the first point')
        return
      }
      expect(await previewHandle?.evaluate((el) => document.contains(el)), `preview element still mounted at step ${step}`).toBe(true)
    },
  )

  await expect(ink).toHaveCount(1)
  await ink.first().click({ button: 'right' })
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await menu.getByText('Delete', { exact: true }).click()
  await expect(ink).toHaveCount(0)
})
