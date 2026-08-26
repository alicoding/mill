import { test, expect } from './fixtures/server'
import { promoteBoardObject, nonSeededBoardObjects } from './fixtures/atlasBoard'
import { createBoardObjectViaRPC, ATLAS_DEFAULT_SPACE_ID } from './fixtures/atlasNativeDropEscapeHatch'
import { ATLAS_KIND_DOCUMENT } from './fixtures/kindPicker'

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
