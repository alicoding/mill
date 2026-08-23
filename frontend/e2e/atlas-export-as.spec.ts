import type { Download } from '@playwright/test'
import { test, expect } from './fixtures/server'
import { createCardViaTray, noteCard, openCard } from './fixtures/atlasBoard'
import { deleteViaPageMenu } from './fixtures/atlasPage'
import { ATLAS_KIND_DOCUMENT } from './fixtures/kindPicker'

// Export-as (ADR-0043 §3, goal 0133 slice E1): the registry's second
// half. buildExportMenuChoice (atlasCardExportMenu.ts) is the single
// source both surfaces render off -- the card page's kebab menu
// (AtlasCardPageHeader.tsx) and the board's right-click context menu
// (useAtlasLinkMenus.tsx) -- so this file proves the menu SHAPE
// (absent / single item / submenu) and a real download's bytes, not
// two separate implementations.
//
// Fresh, uniquely-titled cards rather than seeded ones, so this file
// needs no shared-fixture coordination with any other spec
// (testing.md's shared-pool-vs-dedicated guidance).

async function writeTempFile(name: string, content: string): Promise<string> {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mill-e2e-atlas-export-as-'))
  const file = path.join(dir, name)
  fs.writeFileSync(file, content)
  return file
}

async function readDownload(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

test('a card with nothing exportable (no mirror, no exporters) shows no Export item on either surface', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  const title = 'ZzE2eExportAsNone'
  await createCardViaTray(page, title, { kindID: ATLAS_KIND_DOCUMENT })
  const card = noteCard(page, title)
  const overlay = page.locator('[data-component="atlas-card-overlay"]')

  await openCard(page, card)
  await expect(overlay).toBeVisible()
  await overlay.getByTestId('atlas-page-menu').click()
  await expect(page.getByTestId('atlas-page-menu-export-as')).toHaveCount(0)
  // Escape closes the still-open kebab ActionMenu first, not the
  // Dialog underneath it -- the close button is the deterministic way
  // to dismiss both in one step.
  await page.keyboard.press('Escape')
  await overlay.getByTestId('atlas-page-close').click()
  await expect(overlay).not.toBeVisible()

  await card.click({ button: 'right' })
  const menu = page.getByTestId('context-menu')
  await expect(menu).toBeVisible()
  await expect(menu.getByText('Export as', { exact: false })).toHaveCount(0)
  await page.keyboard.press('Escape')

  await openCard(page, card)
  await expect(overlay).toBeVisible()
  await deleteViaPageMenu(page, overlay)
  await expect(card).not.toBeVisible()
})

test('an icon-fallback card (a .pdf, exporters: []) still offers "Export as Original file" -- the registry-level default', async ({ page }) => {
  const pdfFile = await writeTempFile('report.pdf', '%PDF-1.4 not a real pdf, just bytes for the round trip')

  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  const title = 'ZzE2eExportAsIconFallback'
  await createCardViaTray(page, title, { kindID: ATLAS_KIND_DOCUMENT })
  const card = noteCard(page, title)
  const overlay = page.locator('[data-component="atlas-card-overlay"]')

  await openCard(page, card)
  await expect(overlay).toBeVisible()
  await overlay.getByTestId('atlas-page-add-mirror-path').click()
  await overlay.getByTestId('atlas-page-mirror-path').fill(pdfFile)
  await overlay.getByTestId('atlas-page-mirror-path').blur()
  await expect(overlay.getByTestId('atlas-page-saved-tick')).toBeVisible()

  // Exactly one format -> a single item, no submenu (ADR-0043 §3).
  await overlay.getByTestId('atlas-page-menu').click()
  const exportItem = page.getByTestId('atlas-page-menu-export-as')
  await expect(exportItem).toHaveText('Export as Original file')

  const downloadPromise = page.waitForEvent('download')
  await exportItem.click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('report.pdf')
  const data = await readDownload(download)
  expect(data.toString('utf8')).toBe('%PDF-1.4 not a real pdf, just bytes for the round trip')

  await page.keyboard.press('Escape')
  await expect(overlay).not.toBeVisible()
  await openCard(page, card)
  await expect(overlay).toBeVisible()
  await deleteViaPageMenu(page, overlay)
  await expect(card).not.toBeVisible()
})

test('a .drawio card offers Original file + its declared .drawio format via the right-click context menu, both round-trip', async ({ page }) => {
  const drawioXML = '<mxfile host="mill-e2e"><diagram id="page1" name="Page-1"><mxGraphModel><root><mxCell id="0"/></root></mxGraphModel></diagram></mxfile>'
  const drawioFile = await writeTempFile('flow.drawio', drawioXML)

  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  const title = 'ZzE2eExportAsDrawio'
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

  // More than one format -> "Export as..." opens a submenu (ADR-0043 §3).
  await card.click({ button: 'right' })
  const menu = page.getByTestId('context-menu')
  await expect(menu).toBeVisible()
  await menu.getByText('Export as…', { exact: true }).click()
  await expect(menu.getByText('Original file', { exact: true })).toBeVisible()
  await expect(menu.getByText('draw.io diagram (.drawio)', { exact: true })).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await menu.getByText('draw.io diagram (.drawio)', { exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('flow.drawio')
  const data = await readDownload(download)
  expect(data.toString('utf8')).toBe(drawioXML)

  await openCard(page, card)
  await expect(overlay).toBeVisible()
  await deleteViaPageMenu(page, overlay)
  await expect(card).not.toBeVisible()
})

test('a mermaid card offers Original file + .mmd via the page kebab menu\'s submenu, and downloads the source unchanged', async ({ page }) => {
  const mermaidSource = 'graph TD\n  A[Start] --> B[End]\n'
  const mmdFile = await writeTempFile('flow.mmd', mermaidSource)

  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  const title = 'ZzE2eExportAsMermaid'
  await createCardViaTray(page, title, { kindID: ATLAS_KIND_DOCUMENT })
  const card = noteCard(page, title)
  const overlay = page.locator('[data-component="atlas-card-overlay"]')

  await openCard(page, card)
  await expect(overlay).toBeVisible()
  await overlay.getByTestId('atlas-page-add-mirror-path').click()
  await overlay.getByTestId('atlas-page-mirror-path').fill(mmdFile)
  await overlay.getByTestId('atlas-page-mirror-path').blur()
  await expect(overlay.getByTestId('atlas-page-saved-tick')).toBeVisible()

  await overlay.getByTestId('atlas-page-menu').click()
  const exportItem = page.getByTestId('atlas-page-menu-export-as')
  await expect(exportItem).toHaveText('Export as…')
  await exportItem.click()

  const menu = page.getByTestId('context-menu')
  await expect(menu).toBeVisible()
  await expect(menu.getByText('Original file', { exact: true })).toBeVisible()
  await expect(menu.getByText('Mermaid source (.mmd)', { exact: true })).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await menu.getByText('Mermaid source (.mmd)', { exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('flow.mmd')
  const data = await readDownload(download)
  expect(data.toString('utf8')).toBe(mermaidSource)

  await expect(overlay).toBeVisible()
  await deleteViaPageMenu(page, overlay)
  await expect(card).not.toBeVisible()
})
