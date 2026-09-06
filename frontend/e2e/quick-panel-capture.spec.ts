import { test, expect } from './fixtures/server'
import { contextMenu } from './fixtures/contextMenu'
import { openConfigureKind } from './fixtures/configureNav'

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
test('typing text with no matches renders only the two capture rows, Save as note auto-highlighted first; Enter captures it into Scratchpad', async ({ page }) => {
  const mainPage = await page.context().newPage()
  try {
    await mainPage.goto('/')

    await page.goto('/#/quickpanel')
    const search = page.getByRole('combobox', { name: 'Quick Panel search' })
    await expect(search).toBeFocused()

    const captureText = 'ZzE2eQuickCaptureNoMatch'
    await search.fill(captureText)

    // Two capture doors, note first (the auto-highlighted default),
    // task second (goal 0300).
    await expect(page.getByRole('option')).toHaveCount(2)
    await expect(page.getByRole('option').nth(0)).toHaveAccessibleName('Save as note')
    await expect(page.getByRole('option').nth(1)).toHaveAccessibleName('Save as task')
    // No empty group headings under them (goal 0303): only the group
    // that has rows renders.
    await expect(page.getByText('Workflows', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Configure', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Atlas', { exact: true })).toHaveCount(0)
    const saveNoteOption = page.getByRole('option', { name: 'Save as note' })
    await expect(saveNoteOption).toBeVisible()
    await expect(saveNoteOption).toContainText('Lands in Scratchpad')

    await page.keyboard.press('Enter')
    await expect(search).toHaveValue('')

    await mainPage.getByRole('link', { name: 'Atlas' }).click()
    await expect(mainPage.getByTestId('atlas-board')).toBeVisible()
    // The capture just filed a note into Scratchpad, so it renders
    // as a region frame now (goal 0266's frame-role law) -- and the
    // captured sticky is already visible in its preview from here.
    const scratchpad = mainPage.locator('[data-testid="atlas-group-card"]').filter({ has: mainPage.locator('[aria-label="Zoom into Scratchpad"]') })
    await expect(scratchpad).toBeVisible()
    await scratchpad.getByTestId('atlas-group-header').click()
    const menu = contextMenu(mainPage)
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

test('typing text that matches an existing card renders the capture rows last, after every match', async ({ page }) => {
  await page.goto('/#/quickpanel')
  const search = page.getByRole('combobox', { name: 'Quick Panel search' })
  await expect(search).toBeFocused()

  await search.fill('Discovery workstream')
  await expect(page.getByRole('option', { name: 'Discovery workstream' })).toBeVisible()

  const options = page.getByRole('option')
  const count = await options.count()
  expect(count).toBeGreaterThanOrEqual(3)
  await expect(options.nth(count - 2)).toHaveAccessibleName('Save as note')
  await expect(options.nth(count - 1)).toHaveAccessibleName('Save as task')
})

// Save as task (goal 0300): the second capture door lands the typed
// line as a row of the seeded Task tracker, scheduled for today.
test('Save as task lands the typed line as a tracker row scheduled for today', async ({ page }) => {
  const mainPage = await page.context().newPage()
  try {
    // The grid's accessibility rows carry only the cells in view, and
    // the scheduled-date column sits past the pane's edge at 1280px
    // beside the Configure rail -- a wider window keeps it in view.
    await mainPage.setViewportSize({ width: 1600, height: 900 })
    await mainPage.goto('/')
    await page.goto('/#/quickpanel')
    const search = page.getByRole('combobox', { name: 'Quick Panel search' })
    await expect(search).toBeFocused()
    const captureText = 'ZzE2eQuickCaptureTask'
    await search.fill(captureText)

    const saveTask = page.getByRole('option', { name: 'Save as task' })
    await expect(saveTask).toBeVisible()
    await expect(saveTask).toContainText('Task tracker')
    await saveTask.click()
    await expect(search).toHaveValue('')

    await mainPage.getByRole('link', { name: 'Configure' }).click()
    await openConfigureKind(mainPage, 'Lists')
    const trackerRow = mainPage.locator('[data-testid="inventory-row"][data-entity="list"]', { has: mainPage.getByText('Engagement tasks', { exact: true }) })
    await trackerRow.getByText('Engagement tasks', { exact: true }).click()
    const glide = mainPage.getByTestId('atlas-projection-glide')
    const row = glide.locator('[role="grid"] [role="row"]').filter({ hasText: captureText })
    await expect(row).toHaveCount(1)
    const today = new Date()
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    await expect(row).toContainText(iso)
    await expect(row).toContainText('In progress')

    // Cleanup: delete the row through the grid's own row menu.
    const rowIndex = Number(await row.getAttribute('aria-rowindex')) - 2
    const { clickGlideCell } = await import('./fixtures/glideGrid')
    await clickGlideCell(mainPage, glide, rowIndex, 0, { button: 'right' })
    await mainPage.getByTestId('list-grid-row-delete').click()
    await expect(row).toHaveCount(0)
  } finally {
    await mainPage.close()
  }
})
