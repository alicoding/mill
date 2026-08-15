import { test, expect } from './fixtures/server'

// The mobile companion pass (goal 0068): the phone's five jobs, driven
// through the SAME seeded workflows/spaces the desktop suite already
// proves, at a real phone viewport (390x844, iPhone 12/13-class) --
// per-test viewport rather than a second Playwright project, so this
// stays one extra file, not a doubled suite (playwright.config.ts is
// otherwise untouched). The nav drawer replaces the always-visible
// desktop sidebar below 768px (App.module.css), so every navigation
// here opens it via the hamburger first.
test.use({ viewport: { width: 390, height: 844 } })

async function openDrawerAndNavigate(page: import('@playwright/test').Page, linkName: string) {
  await page.getByTestId('mobile-nav-toggle').click()
  await page.getByRole('link', { name: linkName }).click()
}

test('Mobile nav drawer: hidden by default, opens full-screen, closes on navigation', async ({ page }) => {
  await page.goto('/')
  // The desktop sidebar's own nav (rendered, just hidden off-canvas at
  // this width) never intercepts a click meant for the drawer.
  await expect(page.getByTestId('mobile-nav-toggle')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Workflows' })).toBeHidden()

  await page.getByTestId('mobile-nav-toggle').click()
  await expect(page.getByTestId('mobile-nav-drawer-header')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Workflows' })).toBeVisible()

  await page.getByRole('link', { name: 'Workflows' }).click()
  await expect(page.getByRole('link', { name: 'Workflows' })).toBeHidden()
  await expect(page.getByTestId('mobile-nav-toggle')).toBeVisible()
})

test('Mobile job 1/2/5 -- run a workflow, capture its note, approve the parked run from a phone', async ({ page }) => {
  await page.goto('/')
  await openDrawerAndNavigate(page, 'Workflows')

  const seed = 'Example: Human review with input'
  const row = page.locator('[data-testid="inventory-row"][data-entity="workflow"]').filter({ has: page.getByText(seed, { exact: true }) })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Run' }).click()

  // Quick capture: the declared 'note' Attribute opens the test-input
  // dialog (docs/adr/0008) -- Primer's own Dialog narrows itself at
  // this viewport (confirmed against its compiled CSS, no Mill-side
  // sizing needed), so this is the same dialog the desktop suite drives.
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Note').fill('mobile e2e note')
  await dialog.getByRole('button', { name: 'Run' }).click()

  await openDrawerAndNavigate(page, 'Review')
  const item = page.getByTestId('review-item').filter({ hasText: seed }).first()
  await expect(item).toBeVisible({ timeout: 10_000 })

  // Touch-target floor (goal 0068): the approve/deny pair is at least a
  // 44px thumb target at this viewport, the boring buttons-first
  // convention (Cisco Duo, GitHub mobile notification actions) over a
  // swipe gesture.
  const approve = item.getByTestId('review-approve')
  const box = await approve.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)

  await approve.click()
  await expect(page.getByTestId('review-item').filter({ hasText: seed })).toHaveCount(0, { timeout: 10_000 })
})

test('Mobile job 3 -- Home glances without horizontal overflow', async ({ page }) => {
  await page.goto('/')
  await openDrawerAndNavigate(page, 'Home')
  await expect(page.getByTestId('home-view')).toBeVisible()
  // The KPI grid (HomeView.module.css's auto-fit minmax(240px,1fr))
  // collapses to one column at this width -- the page itself must never
  // scroll horizontally (architecture.md's own artifact-page rule,
  // applied here to the live app shell).
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test('Mobile job 4 -- Atlas shelves glance and card overlay open/close', async ({ page }) => {
  await page.goto('/')
  await openDrawerAndNavigate(page, 'Atlas')
  await expect(page.getByTestId('atlas-view')).toBeVisible()
  await expect(page.getByTestId('atlas-shelves')).toBeVisible()

  const card = page.getByTestId('atlas-shelf-card').filter({ hasText: 'My space' })
  const cardBox = await card.boundingBox()
  expect(cardBox?.height ?? 0).toBeGreaterThanOrEqual(44)

  // The ⓘ affordance opens the full-screen overlay -- the row itself
  // drills instead (AtlasCardBody.tsx), so the overlay's own touch
  // target is what this job actually taps.
  const info = card.getByTestId('atlas-card-info')
  const infoBox = await info.boundingBox()
  expect(infoBox?.height ?? 0).toBeGreaterThanOrEqual(44)
  await info.click()

  const overlay = page.getByRole('dialog')
  await expect(overlay).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(overlay).toBeHidden()
})

test('Mobile job 4 -- Atlas canvas space is pan/zoom only, no card drag', async ({ page }) => {
  await page.goto('/')
  await openDrawerAndNavigate(page, 'Atlas')
  // "My space" (seeded ViewModeCanvas) drills into the React Flow
  // canvas renderer -- same seeded space the desktop atlas.spec.ts
  // suite already drives.
  await page.getByTestId('atlas-shelf-card').filter({ hasText: 'My space' }).click()
  await expect(page.getByTestId('atlas-canvas')).toBeVisible()

  const exampleAreaCard = page.getByTestId('atlas-canvas-card').filter({ hasText: 'Example area' })
  await expect(exampleAreaCard).toBeVisible()
  const node = page.locator('.react-flow__node').filter({ has: exampleAreaCard })
  const before = await node.evaluate((el) => el.style.transform)

  // A drag gesture that would reposition the card in desktop/canvas
  // mode (composition-canvas-interactions.spec.ts's own pattern) must
  // be a no-op here -- canvas read-only fallback (goal 0068), touch
  // pan/zoom stays live via nodesDraggable={false} alone.
  const box = await exampleAreaCard.boundingBox()
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 120, { steps: 5 })
    await page.mouse.up()
  }
  const after = await node.evaluate((el) => el.style.transform)
  expect(after).toBe(before)
})
