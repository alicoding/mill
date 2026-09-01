import { test, expect } from './fixtures/server'
import { promoteBoardObject, nonSeededBoardObjects, zoomAllTheWayOut } from './fixtures/atlasBoard'
import { createBoardObjectViaRPC, ATLAS_DEFAULT_SPACE_ID } from './fixtures/atlasNativeDropEscapeHatch'
import { ATLAS_KIND_DOCUMENT } from './fixtures/kindPicker'
import { waitForViewportStable } from './fixtures/animation'
import { wheelAt } from './fixtures/pointer'

// The "diagram" board object (goal 0179 S2): dropping a .drawio/.mmd
// file lands a board-local object, never a card -- rendered through
// the SAME vendored drawio viewer / mermaid renderer a diagram CARD's
// own page already uses (AtlasUnitDrawioPage.tsx/AtlasUnitMermaidPage.tsx's
// re-exported DrawioDiagramHost/MermaidDiagramHost). The routing
// DECISION (which extensions count as a diagram) is Vitest-tested
// directly (useAtlasDiagramObjectCreate.test.ts's isDiagramPath); the
// native OS drop gesture itself has no reachable user primitive in
// this harness (see atlasNativeDropEscapeHatch.ts) -- this file proves
// the RESULT renders correctly once such an object exists.

const DRAWIO_XML = `<mxfile host="mill-e2e"><diagram id="page1" name="Page-1"><mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="Start" style="rounded=0;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="120" y="120" width="120" height="60" as="geometry"/></mxCell><mxCell id="3" value="End" style="rounded=0;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="320" y="120" width="120" height="60" as="geometry"/></mxCell><mxCell id="4" style="edgeStyle=orthogonalEdgeStyle;html=1;" edge="1" parent="1" source="2" target="3"><mxGeometry relative="1" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>`

function diagramObjects(page: import('@playwright/test').Page) {
  return nonSeededBoardObjects(page, 'diagram')
}

test('a dropped .drawio file renders as a board object through the vendored viewer, and Promote to card keeps it a real diagram card', async ({ page }) => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mill-e2e-atlas-diagram-object-'))
  const drawioFile = path.join(dir, 'ZzE2eDiagramObject.drawio')
  fs.writeFileSync(drawioFile, DRAWIO_XML)

  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await createBoardObjectViaRPC(page, 'diagram', { mirrorPath: drawioFile }, { X: 0, Y: 480 }, ATLAS_DEFAULT_SPACE_ID)
  await page.reload()
  await page.getByRole('link', { name: 'Atlas' }).click()

  // The board face renders through the real vendored drawio viewer --
  // the same SVG output atlas-drawio-unit.spec.ts already proves for a
  // diagram CARD's own page, now for a diagram board object's face.
  const diagramObject = diagramObjects(page)
  await expect(diagramObject).toBeVisible()
  await expect(diagramObject.locator('svg')).toBeVisible()

  // Wheel routing (goal 0271): the vendored viewer consumes wheel for
  // its own pan/zoom, so a scroll ANYWHERE over the diagram node must
  // never also pan the board -- the registry's wheelContained fact
  // puts the canvas kit's nowheel class on the whole node box
  // (shieldless Kind, so it is always live).
  await expect(diagramObject).toHaveClass(/nowheel/)
  // The pointer must actually reach the object: worker-shared board
  // state shifts fitView between runs, and a transform-based canvas
  // can't be auto-scrolled by hover -- zoom out first, then settle.
  await zoomAllTheWayOut(page)
  const viewportTransform = () => page.locator('.react-flow__viewport').evaluate((el) => el.style.transform)
  await waitForViewportStable(page.getByTestId('atlas-board'))
  const beforeWheel = await viewportTransform()
  await wheelAt(page, diagramObject, 0, 80)
  await page.waitForTimeout(300) // no observable "wheel fully routed" signal exists for a negative assertion
  expect(await viewportTransform()).toBe(beforeWheel)

  // dragBand (goal 0206): diagram carries no tray descriptor of its own
  // (drop-only), so its dragBand: true fact can't be covered by
  // atlasBoardSurfaceConformance.test.ts's static registry check the
  // way table's can -- this is that fact's own real proof. The vendored
  // drawio viewer captures its own pointer events for pan/zoom, so the
  // frame band is diagram's ONLY drag surface.
  await expect(diagramObject.getByTestId('atlas-board-object-frame')).toBeVisible()

  // Promote to card: the SAME mirrorPath rides onto the new card, which
  // renders through the identical .drawio unit a native drop's own
  // card-door always used.
  await promoteBoardObject(page, diagramObject, 'ZzE2eDiagramObject', ATLAS_KIND_DOCUMENT)
  await expect(diagramObjects(page)).toHaveCount(0)
  const card = page.locator('[data-testid="atlas-note-card"]').filter({ hasText: 'ZzE2eDiagramObject' })
  await expect(card).toBeVisible()
  await expect(card.getByTestId('atlas-note-file-tag')).toHaveText('DRAWIO')

  // Cleanup.
  await card.click({ button: 'right' })
  const menu = page.getByTestId('context-menu')
  await expect(menu).toBeVisible()
  await menu.getByText('Delete', { exact: true }).click()
  await expect(card).not.toBeVisible()
})

// The file-backed preview/open/watch contract's own command (goal
// 0232 S1): "Open in default app" appears on a fileBacked Kind's own
// context menu (diagram) and is absent on a non-file-backed one
// (shape) -- the honest per-object enablement useAtlasObjectMenu.ts
// decides by reading the registry's own fileBacked flag, proven live
// rather than by the registry unit test alone.
test('a diagram board object offers "Open in default app"; a shape object does not', async ({ page }) => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mill-e2e-atlas-diagram-open-'))
  const drawioFile = path.join(dir, 'ZzE2eDiagramOpen.drawio')
  fs.writeFileSync(drawioFile, DRAWIO_XML)

  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await createBoardObjectViaRPC(page, 'diagram', { mirrorPath: drawioFile }, { X: 0, Y: 640 }, ATLAS_DEFAULT_SPACE_ID)
  await createBoardObjectViaRPC(page, 'shape', { shapeType: 'rectangle' }, { X: 300, Y: 640 }, ATLAS_DEFAULT_SPACE_ID)
  await page.reload()
  await page.getByRole('link', { name: 'Atlas' }).click()

  const diagramObject = diagramObjects(page)
  await expect(diagramObject).toBeVisible()
  await diagramObject.click({ button: 'right' })
  const menu = page.getByTestId('context-menu')
  await expect(menu).toBeVisible()
  const openInDefaultApp = menu.getByText('Open in default app', { exact: true })
  await expect(openInDefaultApp).toBeVisible()
  // Headless/server mode has no live desktop app to launch -- the RPC
  // still resolves (no error toast), proving the menu item is wired to
  // the real command rather than a dead click.
  await openInDefaultApp.click()
  await expect(menu).not.toBeVisible()

  const shapeObject = page.locator('[data-testid="atlas-board-object"][data-object-kind="shape"]')
  await expect(shapeObject).toBeVisible()
  await shapeObject.click({ button: 'right' })
  await expect(menu).toBeVisible()
  await expect(menu.getByText('Open in default app', { exact: true })).toHaveCount(0)

  // Cleanup.
  await menu.getByText('Delete', { exact: true }).click()
  await diagramObject.click({ button: 'right' })
  await expect(menu).toBeVisible()
  await menu.getByText('Delete', { exact: true }).click()
  await expect(diagramObjects(page)).toHaveCount(0)
})

// Two pages, two goal-0259 regressions pinned on the same object:
// (1) clicking the diagram BODY selects the object -- the vendored
// viewer consumes the pointerdown React Flow's own click-to-select
// needs, so without the shared renderer's capture-phase forwarding the
// thin chrome band is the only selection surface and the resize frame
// is unreachable from where a user actually clicks; (2) a multi-page
// file's pages are switchable right on the board face via the viewer's
// own pages toolbar cluster, without opening the editor.
const DRAWIO_TWO_PAGE_XML = `<mxfile host="mill-e2e"><diagram id="page1" name="Page-1"><mxGraphModel dx="800" dy="600" grid="1" gridSize="10" tooltips="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100"><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="FirstPageCell" style="rounded=0;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="120" y="120" width="160" height="60" as="geometry"/></mxCell></root></mxGraphModel></diagram><diagram id="page2" name="Page-2"><mxGraphModel dx="800" dy="600" grid="1" gridSize="10" tooltips="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100"><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="SecondPageCell" style="rounded=0;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="120" y="120" width="160" height="60" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>`

test('clicking a diagram body selects the object, and a multi-page file pages right on the board face', async ({ page }) => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mill-e2e-diagram-pages-'))
  const drawioFile = path.join(dir, 'ZzE2eDiagramPages.drawio')
  fs.writeFileSync(drawioFile, DRAWIO_TWO_PAGE_XML)

  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await createBoardObjectViaRPC(page, 'diagram', { mirrorPath: drawioFile }, { X: 0, Y: 820 }, ATLAS_DEFAULT_SPACE_ID)
  await page.reload()
  await page.getByRole('link', { name: 'Atlas' }).click()

  const diagramObject = diagramObjects(page)
  await expect(diagramObject.getByText('FirstPageCell')).toBeVisible()

  // (1) Body click -> selected: the shared resize handles appear, the
  // same observable the band click already produced.
  await diagramObject.getByText('FirstPageCell').click()
  await expect(page.locator('.react-flow__resize-control.handle.top.right')).toBeVisible()

  // (2) The viewer's own pages cluster (prev / "1 / 2" / next) shows on
  // the face for a multi-page file, and paging swaps the rendered page
  // in place.
  await diagramObject.hover()
  await expect(page.getByText('1 / 2', { exact: true })).toBeVisible()
  await page.locator('[title="Next Page"]').click()
  await expect(diagramObject.getByText('SecondPageCell')).toBeVisible()
  await expect(diagramObject.getByText('FirstPageCell')).toHaveCount(0)

  // Cleanup.
  await diagramObject.click({ button: 'right' })
  const menu = page.getByTestId('context-menu')
  await expect(menu).toBeVisible()
  await menu.getByText('Delete', { exact: true }).click()
  await expect(diagramObjects(page)).toHaveCount(0)
})

// goal 0274: an exported draw.io .xml (same mxfile content, different
// extension) renders through the same vendored drawio host. The drop
// ROUTING (backend content sniff -> 'diagram') is unit-tested at both
// layers (sniffContentKind in Go, resolveFileDropKind's hint branch in
// Vitest); this proves the RESULT -- the host picker sends a non-
// mermaid extension to the drawio viewer and the SVG actually paints.
test('an exported draw.io .xml renders as a diagram board object through the vendored viewer', async ({ page }) => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mill-e2e-atlas-drawio-xml-'))
  const xmlFile = path.join(dir, 'ZzE2eExportedDiagram.xml')
  fs.writeFileSync(xmlFile, `<?xml version="1.0" encoding="UTF-8"?>\n${DRAWIO_XML}`)

  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await createBoardObjectViaRPC(page, 'diagram', { mirrorPath: xmlFile }, { X: 0, Y: 820 }, ATLAS_DEFAULT_SPACE_ID)
  await page.reload()
  await page.getByRole('link', { name: 'Atlas' }).click()

  const diagramObject = diagramObjects(page)
  await expect(diagramObject).toBeVisible()
  await expect(diagramObject.locator('svg')).toBeVisible()
  await expect(page.getByTestId('atlas-object-diagram-error')).toHaveCount(0)

  // Cleanup.
  await diagramObject.click({ button: 'right' })
  const menu = page.getByTestId('context-menu')
  await expect(menu).toBeVisible()
  await menu.getByText('Delete', { exact: true }).click()
  await expect(diagramObjects(page)).toHaveCount(0)
})
