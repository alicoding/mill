import { test, expect } from './fixtures/server'

// Goal 0223: the live-app proof that the seeded board-object examples
// (shape/ink/image/diagram) actually render, at their own address --
// "Board gallery", nested under "The engagement" rather than rendered
// directly on it (boardobject_builtin.go's own comment: a fresh
// install and every e2e worker auto-enter "The engagement" by
// default, so a board object sitting there widens that board's own
// fitView content extent for every OTHER spec, not just this one).
// Read-only: every assertion below reads the seed, never mutates it,
// so this runs on the shared worker pool.
test('the seeded "Board gallery" board demonstrates every seeded board-object kind', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await page.locator('[data-testid="atlas-note-drill"][aria-label="Zoom into Board gallery"]').click()
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Board gallery')

  // The rotated shape (goal 0214's own retroactive seed proof): a
  // real, nonzero rotation baked into the rendered SVG's own inline
  // transform, not just the stored Payload value.
  const shape = page.locator('[data-testid="atlas-board-object"][data-object-kind="shape"]')
  await expect(shape).toBeVisible()
  await expect(shape.locator('[data-testid="atlas-shape-content"]')).toHaveAttribute('style', /rotate\(15deg\)/)

  // Ink and image: both file-backed, rendered through the same
  // mirrored-image door -- a real <img> confirms the seed's own
  // materialized SVG bytes actually loaded, not a placeholder/error.
  const ink = page.locator('[data-testid="atlas-board-object"][data-object-kind="ink"]')
  await expect(ink).toBeVisible()
  await expect(ink.locator('img')).toBeVisible()

  const image = page.locator('[data-testid="atlas-board-object"][data-object-kind="image"]')
  await expect(image).toBeVisible()
  await expect(image.locator('img')).toBeVisible()

  // Diagram: renders through the vendored mermaid host -- an honest
  // absence of the loading/error fallback states is the same "did it
  // actually render" signal AtlasDiagramObjectContent.tsx's own
  // testids expose elsewhere in this suite.
  const diagram = page.locator('[data-testid="atlas-board-object"][data-object-kind="diagram"]')
  await expect(diagram).toBeVisible()
  await expect(page.getByTestId('atlas-object-diagram-error')).toHaveCount(0)
  await expect(page.getByTestId('atlas-object-diagram-loading')).toHaveCount(0)
})
