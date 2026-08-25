import { test, expect } from './fixtures/server'
import { createBoardObjectViaRPC, ATLAS_DEFAULT_SPACE_ID } from './fixtures/atlasNativeDropEscapeHatch'
import { contextMenu } from './fixtures/contextMenu'
import type { Locator, Page } from '@playwright/test'

// The vendored-stencil-data lever (goal 0224 S1): the vendored drawio
// viewer (frontend/public/vendor/drawio/viewer.min.js) is the full
// mxGraph engine with mxStencilRegistry wired for every stencil family,
// but STENCIL_PATH used to point at a dead local path -- ANY
// stencil-styled cell (shape=mxgraph.<family>.<name>) silently degraded
// to a default box, with zero e2e coverage of the gap. This file is
// that missing assertion class: General (basic.xml) and Flowchart
// (flowchart.xml) are now vendored locally
// (frontend/public/vendor/drawio/stencils/PROVENANCE.md), and a cell
// styled with either renders its real stencil geometry -- while a
// family that's still NOT vendored (icon packs -- out of this slice's
// scope) keeps degrading to a default box, unchanged.
//
// Board objects, not cards (goal 0179 S2's diagram noun): landed via
// the same CreateBoardObject RPC escape hatch
// atlas-diagram-object.spec.ts already established for a native-drop-
// only object, then asserted through the real rendered DOM. Assertions
// are scoped to entities this file creates and deletes itself, so it
// runs on the shared worker pool (testing.md's dedicated-vs-shared
// rule).

function diagramObjects(page: Page): Locator {
  return page.locator('[data-testid="atlas-board-object"][data-object-kind="diagram"]')
}

async function deleteObjectViaMenu(object: Locator): Promise<void> {
  const page = object.page()
  await object.click({ button: 'right' })
  const menu = contextMenu(page)
  await expect(menu).toBeVisible()
  await menu.getByText('Delete', { exact: true }).click()
}

// Two vertices, no edges: one styled with a basic.xml stencil (a
// "Heart", picked for a path shape no default-box fallback could ever
// produce by coincidence), one with a flowchart.xml stencil ("Decision",
// a diamond -- also not producible by the rectangular default fallback).
const VENDORED_FAMILIES_XML = `<mxfile host="mill-e2e"><diagram id="page1" name="Page-1"><mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="Heart" style="shape=mxgraph.basic.heart;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="120" height="100" as="geometry"/></mxCell><mxCell id="3" value="Decision" style="shape=mxgraph.flowchart.decision;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="240" y="40" width="120" height="100" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>`

// A family that is deliberately NOT vendored (icon packs stay
// render-only-by-vendoring only once a real diagram needs them, goal
// 0224's research verdict) -- must keep degrading to the same default
// box a stencil-styled cell always rendered as before this change.
const NON_VENDORED_FAMILY_XML = `<mxfile host="mill-e2e"><diagram id="page1" name="Page-1"><mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="EC2" style="shape=mxgraph.aws3d.ec2;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="120" height="100" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>`

test('a diagram board object using vendored basic + flowchart stencils renders real shape geometry', async ({ page }) => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mill-e2e-atlas-diagram-stencils-'))
  const drawioFile = path.join(dir, 'ZzE2eStencilFamilies.drawio')
  fs.writeFileSync(drawioFile, VENDORED_FAMILIES_XML)

  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await createBoardObjectViaRPC(page, 'diagram', { mirrorPath: drawioFile }, { X: 0, Y: 640 }, ATLAS_DEFAULT_SPACE_ID)
  await page.reload()
  await page.getByRole('link', { name: 'Atlas' }).click()

  const diagramObject = diagramObjects(page)
  await expect(diagramObject).toBeVisible()
  const svg = diagramObject.locator('svg').first()
  await expect(svg).toBeVisible()

  // Real stencil geometry renders as <path> elements carrying the
  // shape's own path data -- the default-box fallback renders a plain
  // <rect> instead (verified directly against the vendored viewer: a
  // family with no vendored XML produces zero <path> elements for its
  // vertex, only <rect>). Two vertices, both stencil-styled, zero
  // edges -- both paths must be present.
  await expect(svg.locator('path')).toHaveCount(2)
  await expect(svg.locator('rect')).toHaveCount(0)

  await deleteObjectViaMenu(diagramObject)
  await expect(diagramObjects(page)).toHaveCount(0)
})

test('a diagram board object using a non-vendored stencil family still degrades to the default box', async ({ page }) => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mill-e2e-atlas-diagram-stencils-degrade-'))
  const drawioFile = path.join(dir, 'ZzE2eStencilNonVendored.drawio')
  fs.writeFileSync(drawioFile, NON_VENDORED_FAMILY_XML)

  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await createBoardObjectViaRPC(page, 'diagram', { mirrorPath: drawioFile }, { X: 0, Y: 800 }, ATLAS_DEFAULT_SPACE_ID)
  await page.reload()
  await page.getByRole('link', { name: 'Atlas' }).click()

  const diagramObject = diagramObjects(page)
  await expect(diagramObject).toBeVisible()
  const svg = diagramObject.locator('svg').first()
  await expect(svg).toBeVisible()

  // Unchanged behavior for a family this slice does not vendor: no
  // stencil resolves, so the vertex falls back to the same default-box
  // rectangle it always rendered as.
  await expect(svg.locator('rect')).toHaveCount(1)
  await expect(svg.locator('path')).toHaveCount(0)
  await expect(diagramObject.getByTestId('atlas-drawio-render-error')).toHaveCount(0)

  await deleteObjectViaMenu(diagramObject)
  await expect(diagramObjects(page)).toHaveCount(0)
})
