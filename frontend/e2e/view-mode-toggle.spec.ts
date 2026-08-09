import { test, expect } from '@playwright/test'

// Exercises the shared cards/table view switch (ViewModeToggle +
// Primer DataTable, docs/SPEC.md §3.5's Update) on two inventory
// pages -- the toggle renders a real sortable table of the same rows
// the card view shows, and the choice persists per page.

test('Workflows list switches to a table view and back', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  await page.getByRole('button', { name: 'Table view' }).click()
  const table = page.getByRole('table', { name: 'Saved workflows' })
  await expect(table).toBeVisible()
  // The two seeded built-ins render as table rows with their actions.
  await expect(table.getByRole('row').filter({ hasText: 'Clipboard → Markdown' })).toBeVisible()
  await expect(table.getByRole('button', { name: 'Run Clipboard → Markdown' })).toBeVisible()

  await page.getByRole('button', { name: 'Card view' }).click()
  await expect(page.getByTestId('workflow-row').first()).toBeVisible()
  await expect(table).not.toBeVisible()
})

test('Integrations list switches to a table view showing Method and Auth columns', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()

  await page.getByRole('button', { name: 'Table view' }).click()
  const table = page.getByRole('table', { name: 'Integrations' })
  await expect(table).toBeVisible()
  await expect(table.getByRole('columnheader', { name: 'Method' })).toBeVisible()
  await expect(table.getByRole('columnheader', { name: 'Auth' })).toBeVisible()
  await expect(table.getByRole('row').filter({ hasText: 'Example: Bearer token' })).toBeVisible()

  // Restore card view so other specs (which assert on request-row
  // cards) see the default regardless of run order -- the mode
  // persists in localStorage deliberately.
  await page.getByRole('button', { name: 'Card view' }).click()
  await expect(page.getByTestId('request-row').first()).toBeVisible()
})
