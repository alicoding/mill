import type { Page } from '@playwright/test'
import { expect, test } from './fixtures/server'
import { paletteDialog } from './fixtures/palette'

// Shared worker pool: reads only the embedded docs tree, no app state
// touched. The in-app Docs surface (goal 0125 phase 1): reachable on
// demand (footer link, palette command), deliberately NOT a sidebar
// tab -- a help surface never competes with the work surfaces.

// Opens docs.search via the command palette (no default binding, same
// discoverable-only convention as view.docs -- shared/docsSearchCommands.ts)
// from WHATEVER view the caller is currently on, proving the command
// is reachable from anywhere, not just from inside the Docs surface.
async function openDocsSearch(page: Page) {
  await page.keyboard.press('Meta+K')
  await expect(paletteDialog(page)).toBeVisible()
  await paletteDialog(page).getByRole('combobox').fill('search docs')
  await paletteDialog(page).getByRole('option', { name: 'Search docs', exact: true }).click()
  return page.getByRole('dialog', { name: 'Search docs' })
}

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

// docs.search (goal 0235 S2): reachable from Home (never having opened
// the Docs surface at all), matches BODY text a title-only search would
// miss, and lands on the matched page.
test('docs.search finds a page by body text and navigates to it, from any view', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/`)
  await expect(page.getByRole('link', { name: 'Home' })).toBeVisible()

  const dialog = await openDocsSearch(page)
  await dialog.getByPlaceholder('Search docs').fill('Convert HTML to Markdown')
  const result = dialog.getByRole('option', { name: /Step reference/ })
  await expect(result).toBeVisible()
  await expect(result).toContainText('Convert HTML to Markdown')
  await result.click()

  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('docs-view')).toBeVisible()
  await expect(page.getByTestId('docs-breadcrumb')).toContainText('Step reference')
})

test('docs.search browses every page when the query is empty, and reports no matches for a nonsense query', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/`)
  const dialog = await openDocsSearch(page)
  await expect(dialog.getByRole('option', { name: 'What is Mill' })).toBeVisible()

  await dialog.getByPlaceholder('Search docs').fill('zzz-no-such-phrase-anywhere-zzz')
  await expect(dialog.getByText('No matches')).toBeVisible()
})

// The TOC rail + scroll-spy (goal 0235 S2): Step reference has real
// h2 (kind) and h3 (step) headings from the live step registry.
test('the TOC rail lists a long reference page\'s headings and scroll-spies the active one on click', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/`)
  await page.getByTestId('footer-docs-link').click()
  await expandDocsSection(page, 'Reference')
  await page.getByTestId('docs-nav-item').filter({ hasText: 'Step reference' }).click()
  await expect(page.getByTestId('docs-breadcrumb')).toContainText('Step reference')

  const toc = page.getByTestId('docs-toc')
  await expect(toc).toBeVisible()
  await expect(toc.getByTestId('docs-toc-item').filter({ hasText: 'Triggers' })).toBeVisible()
  const target = toc.getByTestId('docs-toc-item').filter({ hasText: 'Convert HTML to Markdown' })
  await expect(target).toBeVisible()

  // Not yet active before scrolling there.
  await expect(target).not.toHaveAttribute('aria-current', 'location')
  await target.click()
  await expect(target).toHaveAttribute('aria-current', 'location')
})

// Heading anchors (goal 0235 S2, the S1-deferred piece): hover-revealed
// -- present in the DOM at rest (opacity 0) and visible at full opacity
// only once the heading is hovered, the presentation state a plain
// existence assertion can't express (testing.md's interaction-e2e rule).
test('a heading grows a hover-revealed anchor link', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/`)
  await page.getByTestId('footer-docs-link').click()
  await expandDocsSection(page, 'Reference')
  await page.getByTestId('docs-nav-item').filter({ hasText: 'Step reference' }).click()

  const heading = page.getByTestId('docs-content').getByRole('heading', { level: 2, name: 'Triggers' })
  const anchor = heading.getByTestId('docs-heading-anchor')
  await expect(anchor).toHaveCSS('opacity', '0')
  await heading.hover()
  await expect(anchor).toHaveCSS('opacity', '1')
})
