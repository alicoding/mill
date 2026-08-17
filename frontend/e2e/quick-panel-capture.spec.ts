import { test, expect } from './fixtures/server'
import { noteCard } from './fixtures/atlasCards'
import { contextMenu } from './fixtures/contextMenu'

// The away-capture door (docs/goals/0090): QuickPanel.tsx's own
// "Save as note" row, split out of quick-panel.spec.ts (architecture.
// md's 500-line convention) since this pair needs the Atlas board
// fixtures the rest of that file's workflow-row tests never touch.
//
// A query matching nothing leaves the Save-as-note row the only,
// auto-highlighted entry, so a plain Enter captures it as a real Note
// filed into the Scratchpad inbox. Drilling into Scratchpad also
// proves this goal's own Zoom-in widening (useAtlasLinkMenus.tsx): a
// card holding only Notes (no child Cards) is now a valid zoom
// target, where it previously wasn't.
test('typing text with no matches renders only the auto-highlighted Save-as-note row; Enter captures it into Scratchpad', async ({ page }) => {
  const mainPage = await page.context().newPage()
  try {
    await mainPage.goto('/')

    await page.goto('/#/quickpanel')
    const search = page.getByRole('combobox', { name: 'Quick Panel search' })
    await expect(search).toBeFocused()

    const captureText = 'ZzE2eQuickCaptureNoMatch'
    await search.fill(captureText)

    await expect(page.getByRole('option')).toHaveCount(1)
    const saveNoteOption = page.getByRole('option', { name: 'Save as note' })
    await expect(saveNoteOption).toBeVisible()
    await expect(saveNoteOption).toContainText('Lands in Scratchpad')

    await page.keyboard.press('Enter')
    await expect(search).toHaveValue('')

    await mainPage.getByRole('link', { name: 'Atlas' }).click()
    await expect(mainPage.getByTestId('atlas-board')).toBeVisible()
    const scratchpad = noteCard(mainPage, 'Scratchpad')
    await scratchpad.click({ button: 'right' })
    const menu = contextMenu(mainPage)
    await expect(menu).toBeVisible()
    await menu.getByText('Zoom in', { exact: true }).click()
    await expect(mainPage.getByTestId('atlas-breadcrumb')).toContainText('Scratchpad')

    const sticky = mainPage.getByTestId('atlas-sticky-note').filter({ hasText: captureText })
    await expect(sticky).toBeVisible()

    // Cleanup via the note's own existing "Delete note" context menu
    // item -- instant, no confirm (goal 0093), testing.md's within-
    // file/within-worker discipline.
    await sticky.click({ button: 'right' })
    await expect(menu).toBeVisible()
    await menu.getByText('Delete note', { exact: true }).click()
    await expect(sticky).toHaveCount(0)
  } finally {
    await mainPage.close()
  }
})

test('typing text that matches an existing card renders the Save-as-note row last, after every match', async ({ page }) => {
  await page.goto('/#/quickpanel')
  const search = page.getByRole('combobox', { name: 'Quick Panel search' })
  await expect(search).toBeFocused()

  await search.fill('Getting started')
  await expect(page.getByRole('option', { name: 'Getting started' })).toBeVisible()

  const options = page.getByRole('option')
  const count = await options.count()
  expect(count).toBeGreaterThanOrEqual(2)
  await expect(options.nth(count - 1)).toHaveAccessibleName('Save as note')
})
