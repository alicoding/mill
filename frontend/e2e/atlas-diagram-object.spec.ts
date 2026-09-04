import { test, expect } from './fixtures/server'
import { promoteBoardObject, nonSeededBoardObjects, nonSeededBoardObjectWrapper, zoomAllTheWayOut, dragBetween, dragResizeHandle, createCardViaTray, noteCard } from './fixtures/atlasBoard'
import { createBoardObjectViaRPC, ATLAS_DEFAULT_SPACE_ID } from './fixtures/atlasNativeDropEscapeHatch'
import { callBindingViaRPC } from './fixtures/wailsRpc'
import { ATLAS_KIND_DOCUMENT } from './fixtures/kindPicker'
import { waitForViewportStable } from './fixtures/animation'
import { wheelAt, zoomWheelAt } from './fixtures/pointer'

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

  // Wheel routing (goals 0271 + 0302): unselected, the diagram is
  // shielded and the board owns every wheel (no nowheel opt-out);
  // selected, the vendored viewer owns the wheel and the node carries
  // the canvas kit's nowheel class -- the same contract the pdf face
  // has, so every object on the board reads alike.
  await expect(diagramObject).not.toHaveClass(/nowheel/)
  await expect(diagramObject.locator('[data-testid="atlas-object-click-shield"]')).toBeVisible()

  // Window-drag opt-out, in-host half (goal 0276 rider): body drags
  // the native window by its background; the host opts its subtree out.
  expect(await diagramObject.locator('[data-testid="atlas-drawio-page-body"]').evaluate((el) => getComputedStyle(el).getPropertyValue('--wails-draggable').trim())).toBe('no-drag')
  // The pointer must actually reach the object: worker-shared board
  // state shifts fitView between runs, and a transform-based canvas
  // can't be auto-scrolled by hover -- zoom out first, then settle.
  await zoomAllTheWayOut(page)
  const viewportTransform = () => page.locator('.react-flow__viewport').evaluate((el) => el.style.transform)
  await waitForViewportStable(page.getByTestId('atlas-board'))
  const beforeWheel = await viewportTransform()
  // Shield up: a scroll over the diagram pans the board like over any
  // object.
  await wheelAt(page, diagramObject, 0, 80)
  await expect.poll(viewportTransform).not.toBe(beforeWheel)
  await waitForViewportStable(page.getByTestId('atlas-board'))
  // Selected (the shield's click): the viewer owns the wheel, the
  // board holds still.
  await diagramObject.locator('[data-testid="atlas-object-click-shield"]').click()
  await expect(diagramObject).toHaveClass(/nowheel/)
  const beforeLiveWheel = await viewportTransform()
  await wheelAt(page, diagramObject, 0, 80)
  await page.waitForTimeout(300) // no observable "wheel fully routed" signal exists for a negative assertion
  expect(await viewportTransform()).toBe(beforeLiveWheel)

  // Window-drag opt-out, toolbar half (goal 0292, reopening 0276's
  // rider): the viewer appends its hover toolbar to document.body, NOT
  // into the host, so the host assertion above never covered it and
  // holding a zoom button dragged the whole app window. The runtime
  // reads the property off the event target's computed style, so pin
  // it exactly there: the button's own icon (innermost target) and the
  // toolbar container, once the toolbar is actually on screen.
  await diagramObject.locator('[data-testid="atlas-drawio-page-body"]').hover()
  const zoomIn = page.locator('div[title="Zoom In"]') // the canvas kit's own controls carry a <button> of the same title
  await expect(zoomIn).toBeVisible()
  const draggableOf = (el: Element) => getComputedStyle(el).getPropertyValue('--wails-draggable').trim()
  expect(await zoomIn.locator('img').evaluate(draggableOf)).toBe('no-drag')
  expect(await zoomIn.evaluate((el) => (el.parentElement ? getComputedStyle(el.parentElement).getPropertyValue('--wails-draggable').trim() : 'missing'))).toBe('no-drag')

  // Toolbar width (goal 0292, second owner report): the viewer sizes
  // the bar from the host's LAYOUT width, but the board is zoomed all
  // the way out here, so the bar was several times wider than the
  // object on screen. It must match the host's on-screen width, never
  // narrower than the viewer's own button floor (34px per button).
  const hostOnScreenWidth = (await diagramObject.locator('[data-testid="atlas-drawio-page-body"]').boundingBox())?.width ?? 0
  const toolbarBox = await zoomIn.evaluate((el) => {
    const bar = el.parentElement as HTMLElement
    return { width: bar.getBoundingClientRect().width, buttons: bar.childElementCount }
  })
  expect(toolbarBox.width).toBeGreaterThanOrEqual(hostOnScreenWidth - 1)
  expect(toolbarBox.width).toBeLessThanOrEqual(Math.max(hostOnScreenWidth, 34 * toolbarBox.buttons) + 2)

  // A drawing that FITS its frame offers no Fit chip (goal 0340): the
  // chip is a statement about this object, not standing chrome.
  await expect(diagramObject.getByTestId('atlas-board-object-fit')).toHaveCount(0)

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

  // (1) Body click -> selected: the click lands on the shield that
  // covers the body while unselected (goal 0302, the pdf face's own
  // contract) and the shared resize handles appear, the same
  // observable the band click already produced.
  await diagramObject.locator('[data-testid="atlas-object-click-shield"]').click()
  await expect(diagramObject.locator('[data-testid="atlas-object-click-shield"]')).toHaveCount(0)
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

// Regression (goal 0311): a face taller than its sized object never
// paints past the object's box -- the shared wrapper clips every kind,
// so the band stays the object's top edge and neighbours are never
// painted over.
test('a drawing taller than its resized object is clipped to the object box', async ({ page }) => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mill-e2e-diagram-clip-'))
  const drawioFile = path.join(dir, 'ZzE2eDiagramClip.drawio')
  fs.writeFileSync(drawioFile, DRAWIO_XML)

  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()
  await createBoardObjectViaRPC(page, 'diagram', { mirrorPath: drawioFile }, { X: 0, Y: 1300 }, ATLAS_DEFAULT_SPACE_ID)
  await page.reload()
  await page.getByRole('link', { name: 'Atlas' }).click()
  const diagramObject = diagramObjects(page)
  await expect(diagramObject.getByText('Start')).toBeVisible()

  // Shrink the object well below the viewer's own minimum height
  // through the same door a resize handle uses.
  const objectID = await diagramObject.locator('..').getAttribute('data-id')
  expect(objectID).toBeTruthy()
  await callBindingViaRPC(page, 'github.com/alicoding/mill/internal/services/atlassvc.AtlasService.SetBoardObjectSize', [objectID, { W: 260, H: 40 }])

  await expect.poll(async () => {
    const box = await diagramObject.boundingBox()
    return box ? Math.round(box.height) : 0
  }).toBeLessThan(80)
  const objectBox = (await diagramObject.boundingBox())!
  // The viewer's own draw pane, not its <svg>: the face is a fixed
  // viewport now (goal 0340), so the <svg> is exactly the frame while
  // the pane inside it carries the drawing's real extent.
  const drawing = diagramObject.locator('[data-testid="atlas-drawio-page-body"] svg g').first()
  const drawingBox = (await drawing.boundingBox())!
  // The drawing is taller than the box, but what is VISIBLE stops at
  // the box: the wrapper clips.
  const clipped = await diagramObject.locator('[class*="content"]').first().evaluate((el) => getComputedStyle(el).overflow)
  expect(clipped).toBe('hidden')
  expect(drawingBox.height).toBeGreaterThan(objectBox.height)
  const visibleBottom = await drawing.evaluate((el) => {
    const r = el.getBoundingClientRect()
    let parent = el.parentElement
    let bottom = r.bottom
    while (parent) {
      if (getComputedStyle(parent).overflow !== 'visible') bottom = Math.min(bottom, parent.getBoundingClientRect().bottom)
      parent = parent.parentElement
    }
    return bottom
  })
  expect(visibleBottom).toBeLessThanOrEqual(objectBox.y + objectBox.height + 1)

  await diagramObject.click({ button: 'right' })
  const menu = page.getByTestId('context-menu')
  await expect(menu).toBeVisible()
  await menu.getByText('Delete', { exact: true }).click()
  await expect(diagramObjects(page)).toHaveCount(0)
})


// A drawing far taller than any frame it can sit in -- the shape of the
// real files this contract exists for.
const DRAWIO_TALL_XML = (() => {
  const rows: string[] = []
  for (let i = 0; i < 10; i++) {
    rows.push(`<mxCell id="n${i}" value="Row ${i}" style="rounded=0;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="200" y="${40 + i * 200}" width="240" height="80" as="geometry"/></mxCell>`)
  }
  return `<mxfile host="mill-e2e"><diagram id="tall" name="Tall"><mxGraphModel dx="800" dy="600" grid="1" gridSize="10" page="1" pageScale="1" pageWidth="850" pageHeight="1100"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${rows.join('')}</root></mxGraphModel></diagram></mxfile>`
})()

// goal 0340: a diagram larger than its frame moves INSIDE the frame.
// Every movement below goes through the vendored viewer's own graph
// API, so the one observable that proves it is the viewer's own draw
// pane transform -- `scale(s,s)translate(tx,ty)`, written by
// mxGraphView.setTranslate/scaleAndTranslate. The board's viewport
// transform is the negative half of every assertion: a gesture the
// frame has claimed must never also move the canvas underneath it.
test('a selected diagram pans and zooms inside its frame, and says when it is larger than the frame', async ({ page }) => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mill-e2e-diagram-pan-'))
  const drawioFile = path.join(dir, 'ZzE2eDiagramPan.drawio')
  fs.writeFileSync(drawioFile, DRAWIO_TALL_XML)

  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  // The diagram gets a board of its own. Every gesture below is a real
  // pointer press at a real pixel, and the shared root board's own
  // content pushes fitView far enough out that the object lands under
  // the tray/controls; a card this test owns holds exactly one object,
  // so fitView puts it in the clear at a workable size.
  await createCardViaTray(page, 'ZzE2ePanHome')
  const homeID = await page.locator('.react-flow__node').filter({ has: noteCard(page, 'ZzE2ePanHome') }).getAttribute('data-id')
  expect(homeID).toBeTruthy()
  await createBoardObjectViaRPC(page, 'diagram', { mirrorPath: drawioFile }, { X: 80, Y: 80 }, homeID!)
  await page.reload()
  await page.getByRole('link', { name: 'Atlas' }).click()
  await page.locator('[data-testid="atlas-group-card"]').filter({ has: page.locator('[aria-label="Zoom into ZzE2ePanHome"]') }).getByTestId('atlas-group-header').click()
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('ZzE2ePanHome')

  const diagramObject = diagramObjects(page)
  const wrapper = nonSeededBoardObjectWrapper(page, 'diagram')
  await expect(diagramObject.locator('[data-testid="atlas-drawio-page-body"] svg')).toBeVisible()
  await waitForViewportStable(page.getByTestId('atlas-board'))

  const drawPane = diagramObject.locator('[data-testid="atlas-drawio-page-body"] svg g').first()
  const viewerTransform = () => drawPane.getAttribute('transform')
  const boardTransform = () => page.locator('.react-flow__viewport').evaluate((el) => el.style.transform)
  const nodeTransform = () => wrapper.evaluate((el) => (el as HTMLElement).style.transform)

  // At rest, unselected: the chip is the whole signal that there is
  // more drawing than frame. No hover needed to see it.
  const fitChip = diagramObject.getByTestId('atlas-board-object-fit')
  await expect(fitChip).toBeVisible()

  // Hover, still unselected: the shielded face is inert, so the OBJECT
  // has to look interactive before the click is spent.
  const ringWhileHovered = async () => diagramObject.evaluate((el) => getComputedStyle(el).boxShadow)
  expect(await ringWhileHovered()).toBe('none')
  await diagramObject.hover()
  await expect.poll(ringWhileHovered).not.toBe('none')

  // Selected: the shield lifts and the node opts out of BOTH the
  // board's wheel and the board's drag.
  await diagramObject.locator('[data-testid="atlas-object-click-shield"]').click()
  await expect(diagramObject).toHaveClass(/nowheel/)
  await expect(diagramObject.locator('[class*="content"]').first()).toHaveClass(/nodrag/)

  // Wheel: the DRAWING moves, the board holds still.
  await waitForViewportStable(page.getByTestId('atlas-board'))
  const beforeWheelViewer = await viewerTransform()
  const beforeWheelBoard = await boardTransform()
  await wheelAt(page, diagramObject, 0, 240)
  await expect.poll(viewerTransform).not.toBe(beforeWheelViewer)
  expect(await boardTransform()).toBe(beforeWheelBoard)

  // Pinch/ctrl-wheel: the drawing's SCALE changes, still without the
  // board moving.
  const scaleOf = (transform: string | null) => Number(/scale\(([-\d.]+)/.exec(transform ?? '')?.[1] ?? '0')
  const beforeZoomScale = scaleOf(await viewerTransform())
  expect(beforeZoomScale).toBeGreaterThan(0)
  await zoomWheelAt(page, diagramObject, -240)
  await expect.poll(async () => scaleOf(await viewerTransform())).toBeGreaterThan(beforeZoomScale)
  expect(await boardTransform()).toBe(beforeWheelBoard)

  // Drag on the content: the drawing pans, the OBJECT stays put.
  const box = (await diagramObject.boundingBox())!
  const beforeDragViewer = await viewerTransform()
  const beforeDragNode = await nodeTransform()
  await dragBetween(
    page,
    { locator: diagramObject, position: { x: box.width / 2, y: box.height * 0.75 } },
    { locator: diagramObject, position: { x: box.width / 2, y: box.height * 0.25 } },
  )
  await expect.poll(viewerTransform).not.toBe(beforeDragViewer)
  expect(await nodeTransform()).toBe(beforeDragNode)

  // Drag on the chrome band: the OBJECT moves. The band is still the
  // one surface that moves a shielded object, exactly as before. Up and
  // to the left, so the resize handle this test grabs next never ends
  // up under the minimap or the creation tray.
  const band = diagramObject.getByTestId('atlas-board-object-frame')
  const bandBox = (await band.boundingBox())!
  const bandNodeBefore = await nodeTransform()
  await dragBetween(
    page,
    { locator: band, position: { x: bandBox.width / 2, y: bandBox.height / 2 } },
    { x: bandBox.x + bandBox.width / 2 - 60, y: bandBox.y + bandBox.height / 2 - 60 },
  )
  await expect.poll(nodeTransform).not.toBe(bandNodeBefore)

  // Fit: the whole drawing lands inside the frame, so the chip has
  // nothing left to offer and goes away.
  await expect(fitChip).toBeVisible()
  await fitChip.click()
  await expect(fitChip).toHaveCount(0)

  // Resizing the frame refits, so a deliberate resize always lands on a
  // drawing that fills the new box rather than on wherever the last pan
  // left it.
  await wheelAt(page, diagramObject, 0, 200)
  await expect.poll(viewerTransform).not.toBe(null)
  const beforeResize = await viewerTransform()
  await dragResizeHandle(page, page.locator('.react-flow__resize-control.handle.bottom.right'), -60, -60)
  await expect.poll(viewerTransform).not.toBe(beforeResize)

  // Cleanup: the object through its own menu (the door a user has),
  // then the card that held it. The card sits on the parent board this
  // test never returns to, so it goes through the same RPC door the
  // setup used rather than a second navigation.
  await band.click({ button: 'right' })
  const menu = page.getByTestId('context-menu')
  await expect(menu).toBeVisible()
  await menu.getByText('Delete', { exact: true }).click()
  await expect(diagramObjects(page)).toHaveCount(0)
  await callBindingViaRPC(page, 'github.com/alicoding/mill/internal/services/atlassvc.AtlasService.DeleteCard', [homeID])
})
