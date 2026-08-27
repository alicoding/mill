import type { Page } from '@playwright/test'
import { expect, test } from './fixtures/server'

// Shared worker pool: reads only the embedded docs tree, no app state
// touched. The in-app Docs surface (goal 0125 phase 1): reachable on
// demand (footer link, palette command), deliberately NOT a sidebar
// tab -- a help surface never competes with the work surfaces.

// Section headers (NavList.Item + NavList.SubNav, goal 0235 S1) drop
// unknown props once Primer detects the SubNav child and switches to
// the accordion-header render path, so they carry no data-testid --
// located by their exact visible title within the nav landmark instead.
function expandDocsSection(page: Page, title: string) {
  return page.getByTestId('docs-nav').getByText(title, { exact: true }).click()
}

test('the Docs surface renders the index and pages, reached via the footer', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/`)
  // Not a standing sidebar destination.
  await expect(page.getByTestId('sidebar-nav').getByRole('link', { name: 'Docs' })).toHaveCount(0)

  await page.getByTestId('footer-docs-link').click()
  await expect(page.getByTestId('docs-view')).toBeVisible()
  await expect(page.getByTestId('docs-nav-item').first()).toContainText('What is Mill')
  await expect(page.getByTestId('docs-content')).toContainText('guardrailed automations')

  // "Step reference" lives in the Reference section, collapsed by
  // default while "Start here" holds the current page -- expand it
  // before its nav item is reachable.
  await expandDocsSection(page, 'Reference')
  await page.getByTestId('docs-nav-item').filter({ hasText: 'Step reference' }).click()
  await expect(page.getByTestId('docs-content')).toContainText('Convert HTML to Markdown')
})

test('the sidebar groups pages by section, current section expanded, others collapsed', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/`)
  await page.getByTestId('footer-docs-link').click()
  await expect(page.getByTestId('docs-view')).toBeVisible()

  // Default page is in Start here -- its items are reachable, a
  // collapsed section's items are not.
  await expect(page.getByTestId('docs-nav').getByText('Start here', { exact: true })).toBeVisible()
  await expect(page.getByTestId('docs-nav-item').filter({ hasText: 'What is Mill' })).toBeVisible()
  await expect(page.getByTestId('docs-nav-item').filter({ hasText: 'Step reference' })).toBeHidden()

  await expandDocsSection(page, 'Reference')
  await expect(page.getByTestId('docs-nav-item').filter({ hasText: 'Step reference' })).toBeVisible()
})

test('the breadcrumb header names the section and the page title', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/`)
  await page.getByTestId('footer-docs-link').click()
  await expect(page.getByTestId('docs-breadcrumb')).toContainText('Start here')
  await expect(page.getByTestId('docs-breadcrumb')).toContainText('What is Mill')

  await expandDocsSection(page, 'Reference')
  await page.getByTestId('docs-nav-item').filter({ hasText: 'Step reference' }).click()
  await expect(page.getByTestId('docs-breadcrumb')).toContainText('Reference')
  await expect(page.getByTestId('docs-breadcrumb')).toContainText('Step reference')
})

test('the prev/next footer navigates the flat reading order across section boundaries', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/`)
  await page.getByTestId('footer-docs-link').click()

  // First page: no prev link.
  await expect(page.getByTestId('docs-prev-link')).toHaveCount(0)
  await expect(page.getByTestId('docs-next-link')).toContainText('Install')

  await page.getByTestId('docs-next-link').click()
  await expect(page.getByTestId('docs-breadcrumb')).toContainText('Install')

  await page.getByTestId('docs-next-link').click()
  await expect(page.getByTestId('docs-breadcrumb')).toContainText('Your first workflow')
  await expect(page.getByTestId('docs-prev-link')).toContainText('Install')

  // "Your first workflow" is the last Start here page -- next crosses into Concepts.
  await page.getByTestId('docs-next-link').click()
  await expect(page.getByTestId('docs-breadcrumb')).toContainText('Workflows and steps')
  await expect(page.getByTestId('docs-prev-link')).toContainText('Your first workflow')
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
