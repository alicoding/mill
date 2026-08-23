import { test, expect } from './fixtures/server'
import { createCardViaTray, noteCard, openCard } from './fixtures/atlasBoard'
import { deleteViaPageMenu } from './fixtures/atlasPage'
import { ATLAS_KIND_DOCUMENT } from './fixtures/kindPicker'

// The drawio units (ADR-0043, goal 0133 slice 3): a card whose
// MirrorPath ends in ".drawio.svg" renders through the EXISTING
// image-mirror unit -- a valid SVG with no viewer library involved at
// all (the zero-JS fast path) -- while a bare ".drawio" MirrorPath
// renders through the vendored drawio viewer chunk. Both tag DRAWIO on
// the board face and the page header, the same registry-derived tag
// mechanism goal 0133 slice 1 gave every other unit.
//
// Fresh, uniquely-titled cards rather than seeded ones, so this file
// needs no shared-fixture coordination with any other spec
// (testing.md's shared-pool-vs-dedicated guidance).

const DRAWIO_XML = `<mxfile host="mill-e2e" version="1.0">
  <diagram id="page1" name="Page-1">
    <mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <mxCell id="2" value="Start" style="rounded=0;whiteSpace=wrap;html=1;" vertex="1" parent="1">
          <mxGeometry x="120" y="120" width="120" height="60" as="geometry" />
        </mxCell>
        <mxCell id="3" value="End" style="rounded=0;whiteSpace=wrap;html=1;" vertex="1" parent="1">
          <mxGeometry x="320" y="120" width="120" height="60" as="geometry" />
        </mxCell>
        <mxCell id="4" style="edgeStyle=orthogonalEdgeStyle;html=1;" edge="1" parent="1" source="2" target="3">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`

const DRAWIO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">
  <rect x="10" y="10" width="180" height="80" fill="none" stroke="#000000" />
  <text x="100" y="55" text-anchor="middle">Start -&gt; End</text>
</svg>
`

// The vendored viewer defaults a whole family of resource paths to
// these hosts unless pinned first (useDrawioRendering.ts's
// LOCAL_ONLY_PATHS) -- this is the regression guard for that pinning:
// a future vendored-file update that adds a new remote-defaulting
// global gets caught here, not silently missed.
const DRAWIO_REMOTE_HOSTS = ['diagrams.net', 'draw.io', 'github.com', 'gitlab.com']

function isDrawioRemoteHost(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return DRAWIO_REMOTE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
  } catch {
    return false
  }
}

test('a bare .drawio mirror renders through the vendored viewer, tagged DRAWIO', async ({ page }) => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mill-e2e-atlas-drawio-'))
  const drawioFile = path.join(dir, 'flow.drawio')
  fs.writeFileSync(drawioFile, DRAWIO_XML)

  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  // The vendored viewer script must not be present until a .drawio
  // card is actually opened -- pins the "own lazy chunk, never loaded
  // eagerly" claim as a real, checkable regression guard. `typeof`
  // returns a serializable string; page.evaluate can't hand a live
  // function reference back across the CDP boundary (it comes back as
  // undefined either way), so this is the honest way to check it.
  expect(await page.evaluate(() => typeof (window as unknown as { GraphViewer?: unknown }).GraphViewer)).toBe('undefined')

  const remoteRequests: string[] = []
  page.on('request', (req) => {
    if (isDrawioRemoteHost(req.url())) remoteRequests.push(req.url())
  })

  const title = 'ZzE2eDrawioUnit'
  await createCardViaTray(page, title, { kindID: ATLAS_KIND_DOCUMENT })
  const card = noteCard(page, title)
  const overlay = page.locator('[data-component="atlas-card-overlay"]')

  await openCard(page, card)
  await expect(overlay).toBeVisible()
  await overlay.getByTestId('atlas-page-add-mirror-path').click()
  await overlay.getByTestId('atlas-page-mirror-path').fill(drawioFile)
  await overlay.getByTestId('atlas-page-mirror-path').blur()
  await expect(overlay.getByTestId('atlas-page-saved-tick')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(overlay).not.toBeVisible()

  await expect(card.getByTestId('atlas-note-file-tag')).toHaveText('DRAWIO')

  await openCard(page, card)
  await expect(overlay).toBeVisible()
  await expect(overlay.getByTestId('atlas-page-file-tag')).toHaveText('DRAWIO')

  const body = overlay.getByTestId('atlas-drawio-page-body')
  await expect(body).toBeVisible()
  await expect(body.locator('svg')).toBeVisible()
  await expect(overlay.getByTestId('atlas-drawio-render-error')).toHaveCount(0)

  // The vendored viewer is now present -- proves the chunk DID load for
  // an actual .drawio card, the counterpart of the "not present yet"
  // check above.
  expect(await page.evaluate(() => typeof (window as unknown as { GraphViewer?: unknown }).GraphViewer)).toBe('function')

  // No remote fetch happened while rendering -- the pinned local-only
  // base paths (useDrawioRendering.ts) actually won the race against
  // the vendored script's own remote defaults.
  expect(remoteRequests).toEqual([])

  await deleteViaPageMenu(page, overlay)
  await expect(card).not.toBeVisible()
})

test('a .drawio.svg mirror renders as a plain image, no viewer script involved', async ({ page }) => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mill-e2e-atlas-drawio-svg-'))
  const svgFile = path.join(dir, 'flow.drawio.svg')
  fs.writeFileSync(svgFile, DRAWIO_SVG)

  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  const title = 'ZzE2eDrawioSvgUnit'
  await createCardViaTray(page, title, { kindID: ATLAS_KIND_DOCUMENT })
  const card = noteCard(page, title)
  const overlay = page.locator('[data-component="atlas-card-overlay"]')

  await openCard(page, card)
  await expect(overlay).toBeVisible()
  await overlay.getByTestId('atlas-page-add-mirror-path').click()
  await overlay.getByTestId('atlas-page-mirror-path').fill(svgFile)
  await overlay.getByTestId('atlas-page-mirror-path').blur()
  await expect(overlay.getByTestId('atlas-page-saved-tick')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(overlay).not.toBeVisible()

  await expect(card.getByTestId('atlas-note-file-tag')).toHaveText('DRAWIO')

  await openCard(page, card)
  await expect(overlay).toBeVisible()
  await expect(overlay.getByTestId('atlas-page-file-tag')).toHaveText('DRAWIO')

  // Renders through the existing image-mirror unit -- same testid a
  // plain .png/.svg mirror already renders through, no drawio-specific
  // page body at all.
  await expect(overlay.getByTestId('atlas-mirror-image')).toBeVisible()
  await expect(overlay.getByTestId('atlas-drawio-page-body')).toHaveCount(0)

  // No viewer chunk was ever requested for the fast path.
  expect(await page.evaluate(() => typeof (window as unknown as { GraphViewer?: unknown }).GraphViewer)).toBe('undefined')

  await deleteViaPageMenu(page, overlay)
  await expect(card).not.toBeVisible()
})
