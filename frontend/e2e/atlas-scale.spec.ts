import { chromium, expect, test } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  SCALE_MCP_BASE_PORT,
  SCALE_SERVER_BASE_PORT,
  spawnMillServer,
  type SpawnedServer,
} from './fixtures/server'

// Atlas at real-world density (goal 0073): the one-map board against
// the deterministic dense fixture (61 cards, 25 links, nested areas)
// rather than the five-card seed every other atlas spec runs on.
// Spawns its own server (persistence.spec's own-server pattern, its
// own disjoint port range) because the MILL_TEST_DENSE_ATLAS env gate
// must not leak a second board's worth of cards into the standard
// workers' seeded assertions.
// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('a dense area previews bounded: capped tiles, region chips, a truthful ghost tile, and reattached links', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-scale-${idx}-`))
  let server: SpawnedServer | undefined
  const browser = await chromium.launch()
  try {
    server = await spawnMillServer({
      port: SCALE_SERVER_BASE_PORT + idx,
      mcpPort: SCALE_MCP_BASE_PORT + idx,
      settingsPath: path.join(dir, 'settings.json'),
      executionDbPath: path.join(dir, 'execution.db'),
      backupDir: path.join(dir, 'backups'),
      extraEnv: { MILL_TEST_DENSE_ATLAS: '1' },
    })
    const page = await browser.newPage()
    await page.goto(`${server.baseURL}/`)
    await page.getByRole('link', { name: 'Atlas' }).click()
    await expect(page.getByTestId('atlas-board')).toBeVisible()

    // Velocity holds 12 direct children (4 areas + 8 notes) -- the
    // frame previews the capped slots and stays bounded instead of
    // growing a 4-row wall.
    const velocity = page.locator('[data-testid="atlas-group-card"]').filter({ has: page.locator('[aria-label="Zoom into Velocity"]') })
    await expect(velocity).toBeVisible()
    const frameBox = await velocity.boundingBox()
    if (!frameBox) throw new Error('velocity frame has no bounding box')
    expect(frameBox.height).toBeLessThan(450)

    // Nested areas render as region chips (places), leaf children as
    // note cards, and the ghost tile carries the honest remainder:
    // 12 children, 5 drawn (4 chips + 1 note), "+ 7 more".
    await expect(page.getByTestId('atlas-region-chip')).toHaveCount(4)
    const ghost = velocity.getByTestId('atlas-group-overflow')
    await expect(ghost).toHaveText('+ 7 more')

    // The header count states the deep truth regardless of the cap.
    await expect(velocity.getByTestId('atlas-group-header')).toContainText('12 cards')

    // Semantic zoom for lines: endpoints lift to TOP-LEVEL cards, so
    // arteries attach at frame boundaries and intra-area links draw
    // nothing at this level. Exact census on this board: the seeded
    // Getting started <-> Ada link lifts to Example area <-> Getting
    // started (1), the fixture's deep outbound link lifts to
    // Velocity <-> Getting started (1); Ada <-> Project charter and
    // all 24 cross-area links are internal to one area each = 2.
    await expect(page.locator('.react-flow__edge')).toHaveCount(2)

    // Overlap resolution (goal 0073, growth class): the seeded
    // "Example area" frame GREW past its hand-placed footprint (a
    // third child migrated in) and the fixture's Velocity frame
    // arrived programmatically -- no top-level card/frame on this
    // board may overlap any other. Leaf-leaf overlaps would be user
    // placement; everything here is frame-involved, so all must be
    // disjoint.
    const topLevel = [
      velocity,
      page.locator('[data-testid="atlas-group-card"]').filter({ has: page.locator('[aria-label="Zoom into Example area"]') }),
      page.locator('[aria-label="Flip Getting started"]'),
      page.locator('[aria-label="Flip Scratchpad"]'),
    ]
    const rects = []
    for (const loc of topLevel) {
      const r = await loc.boundingBox()
      if (!r) throw new Error('top-level card missing bounding box')
      rects.push(r)
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]
        const b = rects[j]
        const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
        const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
        expect(overlapX <= 0 || overlapY <= 0, `top-level cards ${i} and ${j} overlap`).toBe(true)
      }
    }

    // One zoom level down, the internal detail becomes real lines:
    // Velocity's board draws the 4 aggregated area-to-area arteries
    // (6 links each) the parent level deliberately withheld.
    await velocity.getByTestId('atlas-group-header').click()
    await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Velocity')
    await expect(page.locator('.react-flow__edge')).toHaveCount(4)
    await page.getByTestId('atlas-breadcrumb').getByText('My space', { exact: true }).click()
    await expect(page.getByTestId('atlas-breadcrumb')).not.toContainText('Velocity')

    // Gesture model (goal 0074): a chip answers a single click like
    // every other card -- it flips to its minimal back -- and
    // double-click commits, zooming into the place.
    const platform = page.locator('[data-testid="atlas-region-chip"]').filter({ hasText: 'Platform' })
    await platform.click()
    await expect(platform).toHaveAttribute('data-flipped', 'true')
    await expect(platform.getByTestId('atlas-region-chip-back')).toContainText('flip side')
    await platform.dblclick()
    await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Platform')
    await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Velocity')

    // Inside Platform: 12 leaf cards, no cap at the focused level --
    // you are IN the place; the board shows everything.
    await expect(page.getByTestId('atlas-note-card')).toHaveCount(12)

    // Link-adjacent Auto-arrange (goal 0073, the relationship-blind
    // layout complaint): switching My space to Auto-arrange must seat
    // "Getting started" in the SAME ROW as "Example area" (they share
    // an artery) instead of exiling it to a leaves-band below --
    // adjacency is what keeps arteries out of frame bodies.
    await page.getByTestId('atlas-breadcrumb').getByText('My space', { exact: true }).click()
    await expect(page.getByTestId('atlas-breadcrumb')).not.toContainText('Platform')
    await page.getByTestId('atlas-view-mode-toggle').getByRole('button', { name: 'Auto-arrange' }).click()
    const ea = page.locator('[data-testid="atlas-group-card"]').filter({ has: page.locator('[aria-label="Zoom into Example area"]') })
    const gs = page.locator('[aria-label="Flip Getting started"]')
    await expect(ea).toBeVisible()
    const eaBox = await ea.boundingBox()
    const gsBox = await gs.boundingBox()
    if (!eaBox || !gsBox) throw new Error('auto-arrange assertion cards missing bounding boxes')
    expect(Math.abs(gsBox.y - eaBox.y)).toBeLessThan(3)
    expect(gsBox.x).toBeGreaterThan(eaBox.x + eaBox.width - 3)

    await page.close()
  } finally {
    await browser.close()
    server?.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
