import { expect, test } from './fixtures/server'

// Shared worker pool: reads only the embedded docs tree, no app state
// touched. The in-app Docs surface (goal 0125 phase 1): reachable on
// demand (footer link, palette command), deliberately NOT a sidebar
// tab -- a help surface never competes with the work surfaces.
test('the Docs surface renders the index and pages, reached via the footer', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/`)
  // Not a standing sidebar destination.
  await expect(page.getByTestId('sidebar-nav').getByRole('link', { name: 'Docs' })).toHaveCount(0)

  await page.getByTestId('footer-docs-link').click()
  await expect(page.getByTestId('docs-view')).toBeVisible()
  await expect(page.getByTestId('docs-nav-item').first()).toContainText('What is Mill')
  await expect(page.getByTestId('docs-content')).toContainText('guardrailed automations')

  await page.getByTestId('docs-nav-item').filter({ hasText: 'Step reference' }).click()
  await expect(page.getByTestId('docs-content')).toContainText('Convert HTML to Markdown')
})

// Regression: an anchor inside a rendered page used to navigate the
// app's own webview (an https link left Mill entirely). Cross-links
// between pages must stay in-app instead.
test('a .md cross-link inside a page navigates to that docs page in-app', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/`)
  await page.getByTestId('footer-docs-link').click()
  await page.getByTestId('docs-nav-item').filter({ hasText: 'Your first workflow' }).click()
  await expect(page.getByTestId('docs-content')).toContainText('first workflow')

  // first-workflow.md links "../concepts/guardrails.md".
  await page.getByTestId('docs-content').getByRole('link', { name: 'Guardrails' }).first().click()
  await expect(page.getByTestId('docs-view')).toBeVisible()
  await expect(page.getByTestId('docs-content')).toContainText('effect class')
})

test('the footer Docs link opens the in-app surface', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/`)
  await page.getByTestId('footer-docs-link').click()
  await expect(page.getByTestId('docs-view')).toBeVisible()
})
