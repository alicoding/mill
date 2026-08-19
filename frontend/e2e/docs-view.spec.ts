import { expect, test } from './fixtures/server'

// Shared worker pool: reads only the embedded docs tree, no app state
// touched. The in-app Docs surface (goal 0125 phase 1): the sidebar
// capability renders the canonical index, pages render through the
// shared markdown path, and the footer Docs link lands here.
test('the Docs surface renders the index and pages', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/`)
  await page.getByRole('link', { name: 'Docs' }).click()
  await expect(page.getByTestId('docs-view')).toBeVisible()
  await expect(page.getByTestId('docs-nav-item').first()).toContainText('What is Mill')
  await expect(page.getByTestId('docs-content')).toContainText('guardrailed automations')

  await page.getByTestId('docs-nav-item').filter({ hasText: 'Step reference' }).click()
  await expect(page.getByTestId('docs-content')).toContainText('Convert HTML to Markdown')
})

test('the footer Docs link opens the in-app surface', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/`)
  await page.getByTestId('footer-docs-link').click()
  await expect(page.getByTestId('docs-view')).toBeVisible()
})
