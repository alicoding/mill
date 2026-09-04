import { test, expect } from './fixtures/server'
import { createBoardObjectViaRPC, ATLAS_DEFAULT_SPACE_ID } from './fixtures/atlasNativeDropEscapeHatch'
import { nonSeededBoardObjects } from './fixtures/atlasBoard'
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
// The gallery holds TWO diagram objects: the seeded .drawio golden
// (goal 0340, deliberately taller than its own box, so the in-frame
// pan/zoom contract has a permanent live subject) and a .mmd one this
// test creates for itself, since the mermaid host has no seeded
// example of its own. Every diagram locator below is therefore scoped
// to one or the other, never left ambiguous. Everything else here
// reads the seed, so this stays on the shared worker pool despite the
// one test-owned write.
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

    // Diagram, test-created: renders through the vendored mermaid host
    // -- an honest absence of the loading/error fallback states is the
    // same "did it actually render" signal
    // AtlasDiagramObjectContent.tsx's own testids expose elsewhere in
    // this suite.
    const diagram = nonSeededBoardObjects(page, 'diagram')
    await expect(diagram).toBeVisible()
    await expect(page.getByTestId('atlas-object-diagram-error')).toHaveCount(0)
    await expect(page.getByTestId('atlas-object-diagram-loading')).toHaveCount(0)

    // Diagram, seeded (goal 0340): the .drawio golden paints through
    // the vendored viewer, and because the drawing is taller than the
    // 320px box it sits in, the chrome band carries the Fit chip
    // WITHOUT anything being selected first -- the at-rest signal that
    // there is more here than the frame shows.
    const seededDiagram = page.locator('.react-flow__node[data-id="atlas-object-example-diagram"]')
    await expect(seededDiagram.locator('[data-testid="atlas-drawio-page-body"] svg')).toBeVisible()
    const fitChip = seededDiagram.getByTestId('atlas-board-object-fit')
    await expect(fitChip).toBeVisible()
    // Fit scales the whole drawing into the box, so nothing overflows
    // any more and the chip has nothing left to offer.
    await fitChip.click()
    await expect(fitChip).toHaveCount(0)

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
    // Right-click INSIDE the live viewer opens the OBJECT's own menu
    // (goal 0271): the engine's default frame menu is suppressed and
    // the gesture forwards to the canvas's node context-menu path --
    // proven with a real right-click into the iframe document.
    await viewer.locator('.page[data-page-number="2"]').click({ button: 'right' })
    const objectMenu = page.getByTestId('context-menu')
    await expect(objectMenu).toBeVisible()
    await expect(objectMenu.getByText('Open in default app', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(objectMenu).toHaveCount(0)
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

// linkPdfBytes builds a minimal single-page PDF carrying one URI link
// annotation, with a correct xref (never pdf.js's lenient recovery
// path) -- the TS twin of internal/webviewbridgesmoke's smokePdfBytes.
function linkPdfBytes(url: string): string {
  const content = 'BT /F1 24 Tf 72 690 Td (Link here) Tj ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> /Annots [6 0 R] >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Type /Annot /Subtype /Link /Rect [60 660 320 730] /Border [0 0 0] /A << /S /URI /URI (${url}) >> >>`,
  ]
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((obj, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${obj}\nendobj\n`
  })
  const xrefAt = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`
  return out
}

// goal 0271: an external link clicked inside the live viewer opens
// through the system-browser door, and the app NEVER navigates away
// (the raw default replaced Mill's whole webview with the link's site,
// no back button). The runtime Browser call is intercepted at the
// network layer -- asserting it fired without opening anything real.
test('a link annotation in a live pdf opens externally and never navigates the app', async ({ page }) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mill-e2e-pdf-link-'))
  try {
    const pdfFile = path.join(dir, 'ZzE2eLinkDoc.pdf')
    writeFileSync(pdfFile, linkPdfBytes('https://example.com/mill-e2e-pdf-link'))

    // Best-effort suppression of the runtime's Browser.OpenURL HTTP
    // call so the worker host never actually opens a browser tab. Not
    // an assertion vehicle: the runtime may route calls over its
    // WebSocket transport instead, which no page route can see -- the
    // test's real pin is behavioral (the viewer survives the click).
    await page.route('**/wails/runtime*', async (route) => {
      if (route.request().postData()?.includes('"object":9')) {
        return route.fulfill({ status: 200, body: '{}' })
      }
      return route.fallback()
    })
    await page.goto('/')
    await page.getByRole('link', { name: 'Atlas' }).click()
    await expect(page.getByTestId('atlas-board')).toBeVisible()
    await createBoardObjectViaRPC(page, 'pdf', { mirrorPath: pdfFile, title: 'link doc' }, { X: 40, Y: 900 }, ATLAS_DEFAULT_SPACE_ID)
    await page.reload()
    await page.getByRole('link', { name: 'Atlas' }).click()

    const pdfObject = page.locator('.react-flow__node:not([data-id^="atlas-object-example-"]) [data-testid="atlas-board-object"][data-object-kind="pdf"]')
    await expect(pdfObject).toBeVisible()
    await waitForViewportStable(page.getByTestId('atlas-board'))
    await pdfObject.locator('[data-testid="atlas-object-click-shield"]').click()
    const viewer = page.frameLocator('[data-testid="atlas-pdf-viewer"]')
    const link = viewer.locator('.annotationLayer a').first()
    await expect(link).toBeVisible()
    const appUrl = page.url()
    await link.evaluate((a) => (a as HTMLElement).click()) // escape hatch: a pointer click cannot reach the link -- the iframe sits under the canvas's CSS scale transform, where Playwright's coordinate mapping into subframes lands off-target at board zoom levels
    // The regression pin: WITHOUT the interceptor this click navigates
    // the iframe (and in the desktop webview, the whole app) to the
    // link's site -- the viewer element vanishes. Poll across a settle
    // beat so an in-flight navigation would be caught, then confirm
    // the app itself never moved.
    await page.waitForTimeout(500) // a navigation this test must NOT see has no positive signal to await
    expect(page.url()).toBe(appUrl)
    await expect(page.getByTestId('atlas-board')).toBeVisible()
    await expect(viewer.locator('#viewerContainer')).toBeVisible()
    await expect(link).toBeVisible()
    await page.unroute('**/wails/runtime*')

    // Cleanup: the object.
    await pdfObject.click({ button: 'right' })
    const menu = page.getByTestId('context-menu')
    await expect(menu).toBeVisible()
    await menu.getByText('Delete', { exact: true }).click()
    await expect(pdfObject).toHaveCount(0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
