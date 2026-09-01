import { test, expect } from './fixtures/server'
import { createBoardObjectViaRPC } from './fixtures/atlasNativeDropEscapeHatch'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { waitForViewportStable } from './fixtures/animation'
import { wheelAt } from './fixtures/pointer'

// Goal 0223: the live-app proof that the seeded board-object examples
// (shape/ink/image, plus a diagram this test creates for itself --
// see below) actually render, at their own address -- "Board
// gallery", nested under "The engagement" rather than rendered
// directly on it (boardobject_builtin.go's own comment: a fresh
// install and every e2e worker auto-enter "The engagement" by
// default, so a board object sitting there widens that board's own
// fitView content extent for every OTHER spec, not just this one).
// A seeded 'diagram' golden wedged every e2e worker's server at boot
// (goal 0223's own investigation, root cause not yet fixed), so a
// diagram example is NOT seeded -- this test creates its own via the
// same CreateBoardObject RPC atlas-diagram-object.spec.ts uses,
// nested in the same "Board gallery" card, so the render path still
// gets a live proof. Everything else here reads the seed, so this
// stays on the shared worker pool despite the one test-owned write.
test('the seeded "Board gallery" board demonstrates every seeded board-object kind', async ({ page }) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mill-e2e-atlas-seeded-board-objects-'))
  try {
    const mermaidFile = path.join(dir, 'ZzE2eSeededDiagram.mmd')
    writeFileSync(mermaidFile, 'graph TD\n  A[Board gallery] --> B[Diagram example]\n')

    await page.goto('/')
    await page.getByRole('link', { name: 'Atlas' }).click()
    await expect(page.getByTestId('atlas-board')).toBeVisible()

    await createBoardObjectViaRPC(page, 'diagram', { mirrorPath: mermaidFile }, { X: 960, Y: 80 }, ATLAS_BOARD_GALLERY_ID)
    await page.reload()
    await page.getByRole('link', { name: 'Atlas' }).click()
    await expect(page.getByTestId('atlas-board')).toBeVisible()

    // The gallery renders as a region frame now (goal 0266's
    // frame-role law: object children count) -- drill via its header.
    await page.locator('[data-testid="atlas-group-card"]').filter({ has: page.locator('[aria-label="Zoom into Board gallery"]') }).getByTestId('atlas-group-header').click()
    await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Board gallery')

    // The rotated shape (goal 0214's own retroactive seed proof): a
    // real, nonzero rotation baked into the rendered board object's
    // own inline transform, not just the stored Payload value. Lives
    // on the object's own box (goal 0236), not its inner SVG paint --
    // the ring/resize handles/rotate handle all share this same
    // transform rather than disagreeing with it.
    const shape = page.locator('[data-testid="atlas-board-object"][data-object-kind="shape"]')
    await expect(shape).toBeVisible()
    await expect(shape).toHaveAttribute('style', /rotate\(15deg\)/)

    // Ink and image: both file-backed, rendered through the same
    // mirrored-image door -- a real <img> confirms the seed's own
    // materialized SVG bytes actually loaded, not a placeholder/error.
    const ink = page.locator('[data-testid="atlas-board-object"][data-object-kind="ink"]')
    await expect(ink).toBeVisible()
    await expect(ink.locator('img')).toBeVisible()

    const image = page.locator('[data-testid="atlas-board-object"][data-object-kind="image"]')
    await expect(image).toBeVisible()
    await expect(image.locator('img')).toBeVisible()

    // Sheet (goal 0239 S2): the seeded csv renders as a real grid with
    // its own header row -- the same materialized-bytes signal the
    // ink/image <img> checks above carry, for the tabular door.
    const sheet = page.locator('[data-testid="atlas-board-object"][data-object-kind="sheet"]')
    await expect(sheet).toBeVisible()
    await expect(sheet.getByTestId('atlas-object-sheet-grid').locator('thead th').first()).toHaveText('Item')

    // Diagram: renders through the vendored mermaid host -- an honest
    // absence of the loading/error fallback states is the same "did it
    // actually render" signal AtlasDiagramObjectContent.tsx's own
    // testids expose elsewhere in this suite.
    const diagram = page.locator('[data-testid="atlas-board-object"][data-object-kind="diagram"]')
    await expect(diagram).toBeVisible()
    await expect(page.getByTestId('atlas-object-diagram-error')).toHaveCount(0)
    await expect(page.getByTestId('atlas-object-diagram-loading')).toHaveCount(0)

    // Pdf (goal 0267): the vendored pdf.js viewer renders the seeded
    // two-page document -- page 1's real canvas paints inside the
    // viewer iframe, and the viewer's OWN next-page control reaches
    // page 2 (the page-flip proof, through the engine's own UI, the
    // same adopt-the-viewer's-controls choice the drawio face made).
    const pdf = page.locator('[data-testid="atlas-board-object"][data-object-kind="pdf"]')
    await expect(pdf).toBeVisible()
    // Wheel routing, shield up (goal 0271): an UNSELECTED clickShield
    // Kind is inert, so the wheelContained fact withholds nowheel and
    // a scroll over it pans the board like any body. The reverse wheel
    // restores the viewport exactly (panOnScroll is a 1:1 delta, no
    // zoom), keeping later geometry in this test intact.
    await expect(pdf).not.toHaveClass(/nowheel/)
    const viewportTransform = () => page.locator('.react-flow__viewport').evaluate((el) => el.style.transform)
    await waitForViewportStable(page.getByTestId('atlas-board'))
    const shieldUpTransform = await viewportTransform()
    await wheelAt(page, pdf, 0, 80)
    await expect.poll(viewportTransform).not.toBe(shieldUpTransform)
    await wheelAt(page, pdf, 0, -80)
    await expect.poll(viewportTransform).toBe(shieldUpTransform)
    // Click-to-activate (the clickShield contract): the first click on
    // the face selects the object -- only then is the embedded viewer
    // live. A frameLocator could technically pierce the shield, but
    // the test drives what a user must actually do.
    await pdf.locator('[data-testid="atlas-object-click-shield"]').click()
    await expect(pdf.locator('[data-testid="atlas-object-click-shield"]')).toHaveCount(0)
    const viewer = page.frameLocator('[data-testid="atlas-pdf-viewer"]')
    await expect(viewer.locator('.page[data-page-number="1"] canvas')).toBeVisible()
    // The viewer's findbar input opts out of OS text assistance (goal
    // 0271): the vendored viewer never sets these itself, and WKWebView
    // autocorrected find queries as prose -- the parent applies the
    // attributes through the iframe seam on load.
    await expect(viewer.locator('#findInput')).toHaveAttribute('autocorrect', 'off')
    await expect(viewer.locator('#findInput')).toHaveAttribute('autocomplete', 'off')
    await expect(viewer.locator('#findInput')).toHaveAttribute('spellcheck', 'false')
    // Wheel routing, live viewer (goal 0271): with the shield lifted
    // the registry's wheelContained fact puts nowheel on the whole
    // node box -- a scroll aimed into the viewer must never ALSO pan
    // the board.
    await expect(pdf).toHaveClass(/nowheel/)
    await waitForViewportStable(page.getByTestId('atlas-board'))
    const liveTransform = await viewportTransform()
    await wheelAt(page, pdf, 0, 80)
    // A settled negative: poll the transform staying put across a beat
    // rather than asserting once immediately.
    await page.waitForTimeout(300) // no observable "wheel fully routed" signal exists for a negative assertion
    expect(await viewportTransform()).toBe(liveTransform)
    await expect(viewer.locator('#numPages')).toContainText('2')
    // At board-tile widths the viewer's own responsive toolbar
    // collapses prev/next; the page-number INPUT is the always-visible
    // paging control -- drive that (a real user primitive on the
    // control the user actually sees).
    await viewer.locator('#pageNumber').fill('2')
    await viewer.locator('#pageNumber').press('Enter')
    await expect(viewer.locator('.page[data-page-number="2"] canvas')).toBeVisible()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// The seeded "Board gallery" card's own stable Go ID
// (internal/domain/atlas/builtin.go's cardSketchesID) -- this test's
// own live-created diagram object must file into the SAME container
// the assertions above navigate to, or it exists server-side but
// never renders where this test looks for it.
const ATLAS_BOARD_GALLERY_ID = 'atlas-card-session-sketches'
