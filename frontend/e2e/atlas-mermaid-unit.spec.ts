import { test, expect } from './fixtures/server'
import { createCardViaTray, noteCard, openCard } from './fixtures/atlasBoard'
import { deleteViaPageMenu } from './fixtures/atlasPage'
import { ATLAS_KIND_DOCUMENT } from './fixtures/kindPicker'

// The standalone mermaid unit (ADR-0043, goal 0133 slice 2): a card
// whose MirrorPath is mermaid source (.mmd) renders as a diagram on its
// own page rather than as plain text or the icon fallback, tagged MMD
// on both the page header and the board face -- the same
// registry-derived tag deriveFileTag already gives markdown/image/text
// mirrors (goal 0133 slice 1). A syntactically invalid source keeps its
// raw text visible instead of a broken half-diagram
// (useMermaidRendering's own existing fallback, reused unmodified from
// the markdown-fence case atlas-folder-import.spec.ts already proves).
// A fresh, uniquely-titled card is created rather than reusing a seeded
// one, so this file needs no shared-fixture coordination with any other
// spec (testing.md's shared-pool-vs-dedicated guidance).

test('a .mmd mirror renders as a diagram, tagged MMD; invalid syntax falls back to visible source', async ({ page }) => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mill-e2e-atlas-mermaid-'))
  const validFile = path.join(dir, 'flow.mmd')
  const invalidFile = path.join(dir, 'broken.mmd')
  fs.writeFileSync(validFile, 'graph TD\n  A[Start] --> B[End]\n')
  fs.writeFileSync(invalidFile, 'this is not a valid mermaid diagram {{{\n')

  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  // Mirror fields (Source/Mirror path) only render for a mirror-bearing
  // Kind (atlasCardPageContent.ts's isMirrorKind) -- Document is one of
  // the two seeded kinds that qualifies, same kind the folder-import
  // spec assigns its own mirrored files to.
  const title = 'ZzE2eMermaidUnit'
  await createCardViaTray(page, title, { kindID: ATLAS_KIND_DOCUMENT })
  const card = noteCard(page, title)
  const overlay = page.locator('[data-component="atlas-card-overlay"]')

  await openCard(page, card)
  await expect(overlay).toBeVisible()
  await overlay.getByTestId('atlas-page-add-mirror-path').click()
  await overlay.getByTestId('atlas-page-mirror-path').fill(validFile)
  await overlay.getByTestId('atlas-page-mirror-path').blur()
  await expect(overlay.getByTestId('atlas-page-saved-tick')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(overlay).not.toBeVisible()

  // The MMD tag on the board face's compact chip -- resolved through
  // the same registry the page header below reads.
  await expect(card.getByTestId('atlas-note-file-tag')).toHaveText('MMD')

  await openCard(page, card)
  await expect(overlay).toBeVisible()
  await expect(overlay.getByTestId('atlas-page-file-tag')).toHaveText('MMD')

  // The diagram itself: the standalone page renders through the SAME
  // useMermaidRendering swap the markdown mirror's fences use.
  const body = overlay.getByTestId('atlas-mermaid-page-body')
  await expect(body.getByTestId('atlas-mermaid-diagram')).toHaveCount(1)
  await expect(body.locator('svg')).toBeVisible()

  // Invalid mermaid syntax: the honest fallback keeps the raw source
  // visible instead of a broken half-diagram -- no diagram wrapper, the
  // escaped source text still reads in the DOM.
  await overlay.getByTestId('atlas-page-mirror-path').fill(invalidFile)
  await overlay.getByTestId('atlas-page-mirror-path').blur()
  await expect(overlay.getByTestId('atlas-page-saved-tick')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(overlay).not.toBeVisible()
  await openCard(page, card)
  await expect(overlay).toBeVisible()
  const brokenBody = overlay.getByTestId('atlas-mermaid-page-body')
  await expect(brokenBody.getByTestId('atlas-mermaid-diagram')).toHaveCount(0)
  await expect(brokenBody).toContainText('this is not a valid mermaid diagram')

  // Cleanup (testing.md's within-file discipline): a fresh card this
  // test itself created.
  await deleteViaPageMenu(page, overlay)
  await expect(card).not.toBeVisible()
})
