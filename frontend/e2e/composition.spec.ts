import { test, expect } from '@playwright/test'

// Real Go bindings over HTTP (Wails3 server mode), not mocks -- same
// setup/limitations as runbook.spec.ts (see its header comment):
// clipboard-dependent success content isn't assertable on a headless CI
// runner, so only the environment-independent path is checked here.
// Exercises the prototype built for docs/SPEC.md §3 / ADR-0005:
// CompositionService.NodeTypes()/Recipes()/RunRecipe() -> real React
// rows, no canvas.

function recipeRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="recipe-row"]', { has: page.getByText(label, { exact: true }) })
}

test('Composition page lists node primitives and recipes', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Composition' }).click()
  await expect(page.getByRole('heading', { name: 'Capability composition' })).toBeVisible()

  await expect(page.getByTestId('node-type-row')).toHaveCount(4)
  await expect(recipeRow(page, 'Load sample HTML')).toBeVisible()
  await expect(recipeRow(page, 'Clipboard → Markdown')).toBeVisible()

  // The recipe's node chain renders as chips, not a canvas -- confirms
  // ADR-0005's config-first-not-canvas call visually, not just in prose.
  await expect(recipeRow(page, 'Clipboard → Markdown').getByText('Capture: clipboard HTML')).toBeVisible()
})

test('Running the load-sample recipe produces a visible response, success or error', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Composition' }).click()
  await recipeRow(page, 'Load sample HTML').getByRole('button', { name: 'Run' }).click()
  // Same environment caveat as runbook.spec.ts's load-sample-html test:
  // asserts the full click -> Go binding -> render pipeline produces SOME
  // response, without hard-coding osascript's platform-specific text.
  await expect(recipeRow(page, 'Load sample HTML').getByText(/Quarterly update|no HTML on clipboard|osascript/i)).toBeVisible()
})

test('Running the clipboard-to-markdown recipe produces a visible response, success or error', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Composition' }).click()
  await recipeRow(page, 'Clipboard → Markdown').getByRole('button', { name: 'Run' }).click()
  // On headless CI this is deterministic (no HTML on the clipboard, same
  // as runbook.spec.ts's equivalent test) -- unlike Runbook's tuned
  // soft-failure copy, this prototype's RunRecipe surfaces a plain
  // technical error (composition.go's deliberate simplification). On a
  // real local desktop the two composition tests share one live system
  // clipboard and can race (the other test's Run may leave real HTML
  // behind), so -- exactly like runbook.spec.ts's own load-sample-html
  // test -- this accepts either real conversion or the no-HTML error
  // rather than asserting one deterministic outcome.
  await expect(recipeRow(page, 'Clipboard → Markdown').getByText(/no HTML on clipboard|Quarterly update|osascript/i)).toBeVisible()
})
