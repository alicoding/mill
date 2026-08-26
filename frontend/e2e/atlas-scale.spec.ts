import { chromium, expect, test } from '@playwright/test'
import { openToolbarAction } from './fixtures/toolbarActions'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  SCALE_MCP_BASE_PORT,
  SCALE_SERVER_BASE_PORT,
  spawnMillServer,
  type SpawnedServer,
} from './fixtures/server'
import { waitForViewportStable } from './fixtures/animation'
import { clickBreadcrumbSegment, clickFrameGutter } from './fixtures/atlasBoard'

// Atlas at real-world density (goal 0073): the one-map board against
// the deterministic dense fixture (61 cards, 25 links, nested areas)
// rather than the five-card seed every other atlas spec runs on.
// Spawns its own server (persistence.spec's own-server pattern, its
// own disjoint port range) because the MILL_TEST_DENSE_ATLAS env gate
// must not leak a second board's worth of cards into the standard
// workers' seeded assertions.
// A page's own child-entry count: exactly the "atlas-page-child"/
// "atlas-page-child-group" rows, never a prefix-matched selector --
// a mirrored leaf's own inline preview wrapper carries the sibling
// testid "atlas-page-child-mirror", which a `^=` prefix selector would
// double-count alongside its parent entry.
async function pageChildCount(overlay: import('@playwright/test').Locator): Promise<number> {
  const leaves = await overlay.getByTestId('atlas-page-child').count()
  const groups = await overlay.getByTestId('atlas-page-child-group').count()
  return leaves + groups
}

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
    const board = page.getByTestId('atlas-board')
    await expect(board).toBeVisible()
    // This dense fixture's initial fitView is still animating the
    // board's own `.react-flow__viewport` transform right after it
    // becomes visible -- a boundingBox() read here can race it (the
    // interaction-race class this spec's own retry-passes trace to).
    await waitForViewportStable(board)

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
    // Discovery workstream <-> Jordan link lifts to Client records <->
    // Discovery workstream (1), the fixture's deep outbound link lifts to
    // Velocity <-> Discovery workstream (1); Jordan <-> Statement of work and
    // all 24 cross-area links are internal to one area each = 2.
    await expect(page.locator('.react-flow__edge')).toHaveCount(2)

    // Overlap resolution (goal 0073, growth class): the seeded
    // "Client records" frame GREW past its hand-placed footprint (a
    // third child migrated in) and the fixture's Velocity frame
    // arrived programmatically -- no top-level card/frame on this
    // board may overlap any other. Leaf-leaf overlaps would be user
    // placement; everything here is frame-involved, so all must be
    // disjoint.
    const topLevel = [
      velocity,
      page.locator('[data-testid="atlas-group-card"]').filter({ has: page.locator('[aria-label="Zoom into Client records"]') }),
      page.locator('[aria-label="Open Discovery workstream"]'),
      page.locator('[aria-label="Open Scratchpad"]'),
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
    await clickBreadcrumbSegment(page, page.getByTestId('atlas-breadcrumb').getByText('The engagement', { exact: true }), 'The engagement')
    await expect(page.getByTestId('atlas-breadcrumb')).not.toContainText('Velocity')

    // The click model (goal 0102): a chip answers a single click like
    // every other node -- it selects, replacing any prior selection --
    // and a real double-click commits, zooming into the place (the
    // same outcome two plain clicks in a row produce).
    const platform = page.locator('[data-testid="atlas-region-chip"]').filter({ hasText: 'Platform' })
    await platform.click()
    await expect(page.locator('.react-flow__node.selected').filter({ has: platform })).toHaveCount(1)
    await platform.dblclick()
    await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Platform')
    await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Velocity')

    // Inside Platform: 12 leaf cards, no cap at the focused level --
    // you are IN the place; the board shows everything.
    await expect(page.getByTestId('atlas-note-card')).toHaveCount(12)

    // Link-adjacent Auto-arrange (goal 0073, the relationship-blind
    // layout complaint): the one-shot Auto-arrange action must seat
    // "Discovery workstream" in the SAME ROW as "Client records" (they share
    // an artery) instead of exiling it to a leaves-band below --
    // adjacency is what keeps arteries out of frame bodies.
    await clickBreadcrumbSegment(page, page.getByTestId('atlas-breadcrumb').getByText('The engagement', { exact: true }), 'The engagement')
    await expect(page.getByTestId('atlas-breadcrumb')).not.toContainText('Platform')
    await openToolbarAction(page, 'atlas-auto-arrange')
    const ea = page.locator('[data-testid="atlas-group-card"]').filter({ has: page.locator('[aria-label="Zoom into Client records"]') })
    const gs = page.locator('[aria-label="Open Discovery workstream"]')
    await expect(ea).toBeVisible()
    // Poll: the toggle's re-layout lands a paint or two after the
    // click -- a one-shot sample raced it on CI and measured the
    // FREE-mode positions instead. Captures the two boxes the poll
    // itself last read, rather than re-reading fresh ones for the
    // assertions below -- a re-read after the poll resolves is its own
    // boundingBox-after-animation race if the layout is still settling
    // horizontally even once the Y-alignment check above passes.
    let eaBox: { x: number; y: number; width: number; height: number } | null = null
    let gsBox: { x: number; y: number; width: number; height: number } | null = null
    await expect
      .poll(async () => {
        eaBox = await ea.boundingBox()
        gsBox = await gs.boundingBox()
        if (!eaBox || !gsBox) return Number.NaN
        return Math.abs(gsBox.y - eaBox.y)
      })
      .toBeLessThan(3)
    if (!eaBox || !gsBox) throw new Error('auto-arrange assertion cards missing bounding boxes')
    expect(gsBox.x).toBeGreaterThan(eaBox.x + eaBox.width - 3)

    // Card-page-at-scale (goal 0073 slice B): Velocity's own page --
    // reached with a ⌘-click on the frame body (goal 0102's instant-
    // commit path) -- caps its entries with an honest expander once
    // density crosses the limit, the same deep counts the header row
    // and frame preview already summarize but never list in full.
    // Velocity holds exactly 12 direct children and 0 own links: the
    // page's own entry cap (12) passes every entry through untouched
    // at the exact limit -- no expander. Already viewing "The engagement"
    // (the auto-arrange assertions above never navigated away). A
    // FIXED pixel offset isn't zoom-invariant -- at this dense board's
    // own more-zoomed-out fitView, the same screen-pixel y lands past
    // the header inset into a preview child's own rendered node -- so
    // clickAtFraction samples the frame's GROUP_PADDING gutter as a
    // fraction of its current box instead.
    await waitForViewportStable(board)
    await clickFrameGutter(velocity, { modifiers: ['Meta'] })
    const overlay = page.locator('[data-component="atlas-card-overlay"]')
    await expect(overlay).toBeVisible()
    await expect.poll(() => pageChildCount(overlay)).toBe(12)
    await expect(overlay.getByTestId('atlas-page-show-more')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(overlay).not.toBeVisible()

    // Drill into Velocity and import 4 more DIRECT children (Reports,
    // Meeting Notes, Project Plan, Logo) -- the nested "Q1 Summary"
    // entry is rejected so every accepted entry lands directly under
    // Velocity rather than one level deeper under Reports, landing 16
    // direct children total, past the cap.
    await velocity.getByTestId('atlas-group-header').click()
    await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Velocity')
    await openToolbarAction(page, 'atlas-add-from-folder')
    const importDialog = page.locator('[data-component="atlas-folder-import-dialog"]')
    await expect(importDialog).toBeVisible()
    await importDialog.getByRole('checkbox', { name: 'Q1 Summary' }).uncheck()
    await importDialog.getByRole('button', { name: 'Add 4 cards' }).click()
    await expect(importDialog).not.toBeVisible()
    await clickBreadcrumbSegment(page, page.getByTestId('atlas-breadcrumb').getByText('The engagement', { exact: true }), 'The engagement')
    await expect(page.getByTestId('atlas-breadcrumb')).not.toContainText('Velocity')

    // Past the cap: 11 visible (limit-1) plus an honest "Show 5 more"
    // -- clicking it renders all 16, the expander gone.
    await waitForViewportStable(board)
    await clickFrameGutter(velocity, { modifiers: ['Meta'] })
    await expect(overlay).toBeVisible()
    await expect.poll(() => pageChildCount(overlay)).toBe(11)
    const showMore = overlay.getByTestId('atlas-page-show-more')
    await expect(showMore).toHaveText('Show 5 more')
    await showMore.click()
    await expect.poll(() => pageChildCount(overlay)).toBe(16)
    await expect(overlay.getByTestId('atlas-page-show-more')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(overlay).not.toBeVisible()

    await page.close()
  } finally {
    await browser.close()
    server?.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
