import { test, expect } from '@playwright/test'

// Real Go bindings over HTTP (Wails3 server mode), not mocks. Deliberately
// does NOT assert on the Runbook actions' clipboard-dependent success
// content: internal/adapters/clipboard shells out to osascript, which
// doesn't exist on Linux CI runners and needs a real GUI/pasteboard
// session on macOS ones that headless GitHub runners don't have either
// (same limitation already documented for internal/adapters/clipboard's
// own Go tests and for HotkeyService -- see docs/adr/0002). What's
// asserted below is real and environment-independent; the happy-path
// clipboard round-trip stays a manual .claude/skills/run-mill check on a
// real desktop.

test('Runbook page lists both seeded actions', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Runbook', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Load sample HTML (try it)' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Clipboard → Markdown' })).toBeVisible()
})

test('Spec tab renders real content from the Go-embedded spec', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Spec' }).click()
  await expect(page.getByRole('heading', { name: 'Mill — Living Spec' })).toBeVisible()
})

// Scopes to the action's own card via a data-testid (stable regardless of
// CSS Modules hashing the visual class name) rather than DOM-position
// traversal from the heading, so this doesn't break on unrelated layout
// changes inside the card.
function actionCard(page: import('@playwright/test').Page, actionName: string) {
  return page.locator('[data-testid="runbook-card"]', { has: page.getByRole('heading', { name: actionName }) })
}

test('Clipboard → Markdown responds gracefully with no HTML on the clipboard', async ({ page }) => {
  await page.goto('/')
  await actionCard(page, 'Clipboard → Markdown').getByRole('button', { name: 'Run' }).click()
  // Deterministic on a CI runner: osascript isn't present (Linux) or the
  // clipboard read fails for lack of a GUI session (headless macOS), so
  // this is always the "no HTML on clipboard" soft-failure path -- the
  // same one internal/domain/runbook's own unit test covers directly.
  await expect(page.getByText('No HTML found on the clipboard')).toBeVisible()
})

test('Load sample HTML action produces a visible response, success or error', async ({ page }) => {
  await page.goto('/')
  await actionCard(page, 'Load sample HTML (try it)').getByRole('button', { name: 'Run' }).click()
  // Whether the clipboard write actually succeeds is environment-dependent
  // (see file header) -- this asserts the full click -> Go binding call ->
  // render pipeline produces SOME visible response, not a hang or a blank
  // screen, without hard-coding osascript's platform-specific error text.
  await expect(page.getByText(/Sample HTML is now on your clipboard|error/i)).toBeVisible()
})
