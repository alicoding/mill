import { test, expect } from './fixtures/server'
import { createBoardObjectViaRPC } from './fixtures/atlasNativeDropEscapeHatch'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Goal 0223: the live-app proof that the seeded board-object examples
// (shape/ink/image, plus a diagram this test creates for itself --
// see below) actually render, at their own address -- "Board
// gallery", nested under "The engagement" rather than rendered
// directly on it (boardobject_builtin.go's own comment: a fresh
// install and every e2e worker auto-enter "The engagement" by
// default, so a board object sitting there widens that board's own
// fitView content extent for every OTHER spec, not just this one).
// A seeded 'diagram' golden wedged every e2e worker's server at boot
// (goal 0223's own investigation, root cause not yet fixed), so a
// diagram example is NOT seeded -- this test creates its own via the
// same CreateBoardObject RPC atlas-diagram-object.spec.ts uses,
// nested in the same "Board gallery" card, so the render path still
// gets a live proof. Everything else here reads the seed, so this
// stays on the shared worker pool despite the one test-owned write.
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

    await page.locator('[data-testid="atlas-note-drill"][aria-label="Zoom into Board gallery"]').click()
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

    // Diagram: renders through the vendored mermaid host -- an honest
    // absence of the loading/error fallback states is the same "did it
    // actually render" signal AtlasDiagramObjectContent.tsx's own
    // testids expose elsewhere in this suite.
    const diagram = page.locator('[data-testid="atlas-board-object"][data-object-kind="diagram"]')
    await expect(diagram).toBeVisible()
    await expect(page.getByTestId('atlas-object-diagram-error')).toHaveCount(0)
    await expect(page.getByTestId('atlas-object-diagram-loading')).toHaveCount(0)
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
