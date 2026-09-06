import { test, expect } from './fixtures/server'
import { nonSeededBoardObjects, nonSeededBoardObjectWrapper, dragBetween, dragResizeHandle, createCardViaTray, noteCard } from './fixtures/atlasBoard'
import { createBoardObjectViaRPC } from './fixtures/atlasNativeDropEscapeHatch'
import { callBindingViaRPC } from './fixtures/wailsRpc'
import { waitForViewportStable } from './fixtures/animation'
import { wheelAt, zoomWheelAt } from './fixtures/pointer'

// The diagram board object's IN-FRAME interaction, split out of
// atlas-diagram-object.spec.ts along its own seam (the 500-line
// convention): that file proves a dropped file renders, routes and
// carries the right menu items; this one proves what a pointer does
// INSIDE a rendered one -- pan, zoom, fit, and the chrome that offers
// them now that the vendored viewer contributes no toolbar of its own
// (goal 0354).
function diagramObjects(page: import('@playwright/test').Page) {
  return nonSeededBoardObjects(page, 'diagram')
}

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

  // Selected: the shield lifts and the FACE opts out of the board's
  // wheel and the board's drag at once -- the chrome band, a sibling of
  // the face, keeps panning the board.
  await diagramObject.locator('[data-testid="atlas-object-click-shield"]').click()
  const inFrameFace = diagramObject.getByTestId('atlas-board-object-face')
  await expect(inFrameFace).toHaveClass(/nowheel/)
  await expect(inFrameFace).toHaveClass(/nodrag/)

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

  // No vendor chrome on the board (goal 0354): the object is selected
  // and hovered, which is exactly when the viewer used to append its own
  // toolbar to the document body -- in SCREEN space, so it escaped the
  // object's frame the moment the drawing moved. The bar carries no
  // class of its own; each of its buttons is an `img.geAdaptiveAsset`
  // (viewer.min.js's own addButton), and the bar is a direct child of
  // body, so that pairing is what proves it was never created.
  await diagramObject.hover()
  await expect(page.locator('body > div img.geAdaptiveAsset')).toHaveCount(0)

  // Fit: the whole drawing lands inside the frame, so the chip has
  // nothing left to offer and goes away.
  await expect(fitChip).toBeVisible()
  await fitChip.click()
  await expect(fitChip).toHaveCount(0)

  // "Fit diagram" on the object's own menu is the SAME fit (goal 0354):
  // the controls the vendored bar used to carry now live on the
  // object's chrome, so a pan is undone from the menu the band opens.
  const fittedTransform = await viewerTransform()
  const panBox = (await diagramObject.boundingBox())!
  await dragBetween(
    page,
    { locator: diagramObject, position: { x: panBox.width / 2, y: panBox.height * 0.7 } },
    { locator: diagramObject, position: { x: panBox.width / 2, y: panBox.height * 0.3 } },
  )
  await expect.poll(viewerTransform).not.toBe(fittedTransform)
  const bandForMenu = (await band.boundingBox())!
  await band.click({ button: 'right', position: { x: 6, y: bandForMenu.height / 2 } })
  const fitMenu = page.getByTestId('context-menu')
  await expect(fitMenu).toBeVisible()
  await fitMenu.getByText('Fit diagram', { exact: true }).click()
  await expect.poll(viewerTransform).toBe(fittedTransform)

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
