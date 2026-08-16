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

    // Link reattachment: no line vanishes with a hidden endpoint --
    // each resolves to its deepest VISIBLE ancestor. Exact census on
    // this board: 2 seed links (both endpoints previewed inside
    // Example area / top level) + the fixture's 24 deep cross-area
    // links resolving up to the 4 rendered area CHIPS and deduping to
    // 4 chip-to-chip lines + 1 deep outbound link reattaching as
    // Platform-chip -> Getting started = 7.
    await expect(page.locator('.react-flow__edge')).toHaveCount(7)

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

    await page.close()
  } finally {
    await browser.close()
    server?.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
