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

// Precise per-card matching (goal 0072 slice A): a plain hasText
// substring filter is unreliable since a card's own BACK face can
// legitimately contain another card's title (its own "<kind> -> <other
// title>" link row) -- aria-label carries the exact title instead.
function noteCard(page: import('@playwright/test').Page, title: string) {
  return page.locator(`[data-testid="atlas-note-card"][aria-label="Open ${title}"]`)
}

function groupCard(page: import('@playwright/test').Page, title: string) {
  return page.locator('[data-testid="atlas-group-card"]').filter({ has: page.locator(`[aria-label="Zoom into ${title}"]`) })
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

// Regression: Settings lives in a bottom-anchored footer slot below the
// capability NavList (AppSidebar.tsx), on the same element Primer's
// PageLayout.Sidebar sizes to a plain `height: 100vh` at this breakpoint
// (confirmed against its compiled CSS) -- real mobile Safari's 100vh
// exceeds the visually available viewport whenever its own chrome is
// showing, pushing a bottom-anchored row like this one off-screen with
// no scroll affordance to reach it. App.module.css's dvh fallback pins
// the fix; this pins that Settings stays reachable through the drawer.
test('Mobile nav drawer: Settings is reachable, labelled, and navigates', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('mobile-nav-toggle').click()

  const settingsLink = page.getByRole('link', { name: 'Settings' })
  await expect(settingsLink).toBeVisible()
  const box = await settingsLink.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)

  await settingsLink.click()
  await expect(page.getByTestId('settings-view')).toBeVisible()
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

test('Mobile job 4 -- Atlas board glance, drill via a region frame header, and card overlay open/close', async ({ page }) => {
  await page.goto('/')
  await openDrawerAndNavigate(page, 'Atlas')
  await expect(page.getByTestId('atlas-view')).toBeVisible()
  // The single seeded root auto-enters "The engagement" (Free mode); the
  // group-frame glance lives one drill down, in "Client records".
  await expect(page.getByTestId('atlas-board')).toBeVisible()
  // At this viewport the seeded board is wider than min-zoom can fit,
  // so "Client records" can sit off-screen and Playwright's
  // scroll-into-view fights React Flow's transform (element never
  // stable). The jump dialog is the app's own door for exactly this --
  // Enter flies the camera to the match -- so land attention first,
  // then drill.
  await page.keyboard.press('Meta+k')
  await page.getByTestId('atlas-jump-input').fill('Client records')
  await expect(page.locator('[data-component="atlas-jump-dialog"]').getByTestId('atlas-jump-result').first()).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-component="atlas-jump-dialog"]')).toHaveCount(0)
  await groupCard(page, 'Client records').getByTestId('atlas-group-header').click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  // No manual pan: the level's packer seats are deterministic and the
  // drill's own fitView already frames them -- the old center-drag
  // "pan to reach the far card" could land on whichever CARD sat
  // under the pane's center and drag it (not the pane) out of view.
  const card = noteCard(page, 'Jordan Reyes')
  const cardBox = await card.boundingBox()
  // The 44px CSS floor measured through the board's zoom transform can
  // round a hair under (43.9999...) -- a half-pixel epsilon accepts
  // scale rounding without accepting a genuinely shrunken target.
  expect(cardBox?.height ?? 0).toBeGreaterThanOrEqual(43.5)

  // The click model (goal 0102): the first tap selects, the second tap
  // on the now-selected card commits -- opening the full-screen
  // overlay is the one-map model's own touch target, the card itself
  // (already checked >=44px above), never a separate face/button.
  await card.click()
  const selectedWrapper = page.locator('.react-flow__node.selected').filter({ has: card })
  await expect(selectedWrapper).toHaveCount(1)
  await card.click()

  const overlay = page.getByRole('dialog')
  await expect(overlay).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(overlay).toBeHidden()
})

test('Mobile job 4 -- Atlas board is pan/zoom only, no card drag', async ({ page }) => {
  await page.goto('/')
  await openDrawerAndNavigate(page, 'Atlas')
  // The single seeded root auto-enters "The engagement" (seeded
  // ViewModeCanvas) -- the React Flow board IS the landing.
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  const exampleAreaCard = groupCard(page, 'Client records')
  await expect(exampleAreaCard).toBeVisible()
  const node = page.locator('.react-flow__node').filter({ has: exampleAreaCard })
  const before = await node.evaluate((el) => el.style.transform)

  // A drag gesture that would reposition the card in desktop/Free mode
  // (composition-canvas-interactions.spec.ts's own pattern) must be a
  // no-op here -- canvas read-only fallback (goal 0068), touch pan/zoom
  // stays live via nodesDraggable={false} alone. Targets the frame
  // body below its header strip -- the header is a click/drill target,
  // not the surface this gesture means to test.
  const box = await exampleAreaCard.boundingBox()
  if (box) {
    const startY = box.y + box.height * 0.75
    await page.mouse.move(box.x + box.width / 2, startY)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 120, startY + 120, { steps: 5 })
    await page.mouse.up()
  }
  const after = await node.evaluate((el) => el.style.transform)
  expect(after).toBe(before)
})
