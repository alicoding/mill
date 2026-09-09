import { test, expect } from './fixtures/server'
import type { Page } from '@playwright/test'
import { openToolbarAction } from './fixtures/toolbarActions'
import { openAtlas } from './fixtures/atlasPage'
import { paletteDialog } from './fixtures/palette'
import { callBindingViaRPC } from './fixtures/wailsRpc'
import { waitForAppReady } from './fixtures/appReady'

// The board's five views as one switcher surface (docs/goals/0355 S2):
// List, Matrix, Coverage and Roadmap are PANES of the board's own
// region -- no dialog, no backdrop -- the toolbar row stays above all
// of them, the active view rides the persisted atlas View (zustand
// 'mill-app-view'), and Escape is the same gesture the dialog era
// carried. Shared pool: every assertion here is chrome/view state of
// the test's own session; the one workflow the tab-switch case needs
// is created through the real Go binding a click reaches
// (fixtures/wailsRpc.ts) and deleted before the test ends.
const COMPOSITION = 'github.com/alicoding/mill/internal/services/compositionsvc.CompositionService.'

// Matrix, Coverage and Roadmap are the bundled mill-matrix/
// mill-coverage/mill-roadmap plugins (goal 0357, S2 for the first two):
// each pane's content is a sandboxed iframe (PluginFrame), identified
// by the standard plugin-view host testid rather than a
// `data-component` marker the one built-in pane (List) still carries
// on its own root element.
const VIEWS = [
  { segment: 'atlas-open-contents', dataView: 'list', paneComponent: 'atlas-contents-pane' },
  { segment: 'atlas-open-plugin-mill-coverage-coverage', dataView: 'plugin:mill-coverage.coverage', paneComponent: 'plugin-view-mill-coverage-coverage' },
  { segment: 'atlas-open-plugin-mill-matrix-matrix', dataView: 'plugin:mill-matrix.matrix', paneComponent: 'plugin-view-mill-matrix-matrix' },
  { segment: 'atlas-open-plugin-mill-roadmap-roadmap', dataView: 'plugin:mill-roadmap.roadmap', paneComponent: 'plugin-view-mill-roadmap-roadmap' },
] as const

async function assertView(page: Page, dataView: string, paneComponent: string | null): Promise<void> {
  if (paneComponent === null) {
    await expect(page.getByTestId('atlas-projection-pane')).toHaveCount(0)
    await expect(page.getByTestId('atlas-board')).toBeVisible()
    return
  }
  const pane = page.getByTestId('atlas-projection-pane')
  await expect(pane).toHaveAttribute('data-view', dataView)
  const paneContent = paneComponent.startsWith('plugin-view-') ? page.getByTestId(paneComponent) : page.locator(`[data-component="${paneComponent}"]`)
  await expect(paneContent).toBeVisible()
  // The pane replaces the canvas in place: no dialog chrome, no
  // backdrop, anywhere on the page.
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

test('the switcher tours all five views directly, each a pane with no dialog backdrop', async ({ page }) => {
  await openAtlas(page)
  for (const { segment, dataView, paneComponent } of VIEWS) {
    await openToolbarAction(page, segment)
    await assertView(page, dataView, paneComponent)
    await expect(page.getByTestId(segment)).toHaveAttribute('aria-pressed', 'true')
  }
  await openToolbarAction(page, 'atlas-open-board')
  await assertView(page, 'board', null)
  await expect(page.getByTestId('atlas-open-board')).toHaveAttribute('aria-pressed', 'true')
})

test('Escape in a projection returns to the Board', async ({ page }) => {
  await openAtlas(page)
  await openToolbarAction(page, 'atlas-open-plugin-mill-matrix-matrix')
  await assertView(page, 'plugin:mill-matrix.matrix', 'plugin-view-mill-matrix-matrix')
  await page.keyboard.press('Escape')
  await assertView(page, 'board', null)
  await expect(page.getByTestId('atlas-open-board')).toHaveAttribute('aria-pressed', 'true')
})

test('the active view survives a tab switch away and back, and a reload of the tab', async ({ page }) => {
  await openAtlas(page)
  const label = 'ZzE2eViewsWorkflow'
  const wf = await callBindingViaRPC<{ ID: string }>(page, COMPOSITION + 'CreateWorkflow', [
    label, '', [{ ID: 'n1', Kind: 'trigger', NodeTypeID: 'trigger-manual', Config: {}, Position: { X: 0, Y: 0 } }], [],
  ])
  try {
    await openToolbarAction(page, 'atlas-open-plugin-mill-coverage-coverage')
    await assertView(page, 'plugin:mill-coverage.coverage', 'plugin-view-mill-coverage-coverage')

    // Away: opening a work tab never touches `view`
    // (shared/store.ts's openWorkTab), so the atlas View -- boardView
    // included -- is exactly what it was when the panel hides.
    await page.keyboard.press('Meta+/')
    await paletteDialog(page).getByRole('combobox').fill(label)
    await paletteDialog(page).getByRole('option', { name: new RegExp(`Open: ${label}`) }).click()
    await expect(page.getByRole('tab', { name: label, exact: true })).toHaveAttribute('aria-selected', 'true')

    // Back: the page tab carries today's board title, no view suffix.
    await page.getByRole('tab', { name: 'Atlas', exact: true }).click()
    await assertView(page, 'plugin:mill-coverage.coverage', 'plugin-view-mill-coverage-coverage')

    // The view rides the persisted store, so a reload of the tab lands
    // back on the same pane.
    await page.reload()
    await waitForAppReady(page)
    await assertView(page, 'plugin:mill-coverage.coverage', 'plugin-view-mill-coverage-coverage')
    await expect(page.getByTestId('atlas-open-plugin-mill-coverage-coverage')).toHaveAttribute('aria-pressed', 'true')
  } finally {
    await callBindingViaRPC(page, COMPOSITION + 'DeleteWorkflow', [wf.ID])
  }
})

test('the palette command for Coverage switches the segment too', async ({ page }) => {
  await openAtlas(page)
  await page.keyboard.press('Meta+/')
  await paletteDialog(page).getByRole('combobox').fill('Coverage')
  await paletteDialog(page).getByRole('option', { name: 'Coverage', exact: true }).click()
  await expect(paletteDialog(page)).toHaveCount(0)
  await assertView(page, 'plugin:mill-coverage.coverage', 'plugin-view-mill-coverage-coverage')
  await expect(page.getByTestId('atlas-open-plugin-mill-coverage-coverage')).toHaveAttribute('aria-pressed', 'true')
})
