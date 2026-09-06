import { test, expect } from './fixtures/server'
import { gotoAppReady } from './fixtures/appReady'
import { paletteDialog } from './fixtures/palette'
import { configureKindLink, configureKindNav, configurePane, openConfigureKind } from './fixtures/configureNav'

// Configure navigates by a grouped rail (goal 0116): four titled
// groups, one pane at a time, a filter across groups, a hash route per
// kind, and a palette command per kind. Shared pool: nothing here
// creates or reads an entity -- only the page's own chrome.

async function openConfigure(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await expect(configureKindNav(page)).toBeVisible()
}

test('the rail lists every kind under its group, and only the selected pane is mounted', async ({ page }) => {
  await openConfigure(page)
  const nav = configureKindNav(page)
  for (const group of ['connections', 'runtime', 'data', 'workflowLogic']) {
    await expect(nav.getByTestId(`configure-kind-nav-group-${group}`)).toBeVisible()
  }
  await expect(nav.getByRole('heading', { name: 'Connections' })).toBeVisible()
  await expect(nav.getByText('Where workflows run.')).toBeVisible()
  await expect(nav.getByTestId('configure-kind-nav-group-runtime').getByRole('link')).toHaveText(['Environments', 'Execution Environments'])
  await expect(nav.getByRole('link')).toHaveCount(11)

  // Integrations is the first kind: current, and the only pane in the DOM.
  await expect(configureKindLink(page, 'Integrations')).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('[data-testid^="configure-pane-"]')).toHaveCount(1)

  await openConfigureKind(page, 'Decisions')
  await expect(configureKindLink(page, 'Decisions')).toHaveAttribute('aria-current', 'page')
  await expect(configureKindLink(page, 'Integrations')).not.toHaveAttribute('aria-current', 'page')
  await expect(configurePane(page, 'Integrations')).toBeHidden()
  // A visited pane stays mounted (hidden) so its in-progress state survives.
  await expect(page.locator('[data-testid^="configure-pane-"]')).toHaveCount(2)
  await expect(page).toHaveURL(/#\/configure\/decisions$/)
})

test('the filter narrows kinds across groups and names an empty result', async ({ page }) => {
  await openConfigure(page)
  const filter = page.getByTestId('configure-kind-filter')
  await filter.click()
  await page.keyboard.type('env')
  const nav = configureKindNav(page)
  await expect(nav.getByRole('link')).toHaveText(['Environments', 'Execution Environments'])
  await expect(nav.getByRole('heading', { name: 'Connections' })).toHaveCount(0)
  await expect(nav.getByRole('heading', { name: 'Runtime' })).toBeVisible()

  await filter.fill('zzz')
  await expect(nav.getByRole('link')).toHaveCount(0)
  await expect(page.getByTestId('configure-kind-empty')).toHaveText('No kind matches.')

  await filter.fill('')
  await expect(nav.getByRole('link')).toHaveCount(11)
})

test('a #/configure/<kind> address lands on that kind, and the palette lists one command per kind', async ({ page }) => {
  await gotoAppReady(page, '/#/configure/lists')
  await expect(configurePane(page, 'Lists')).toBeVisible()
  await expect(configureKindLink(page, 'Lists')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('link', { name: 'Configure' })).toHaveAttribute('aria-current', 'page')

  await page.keyboard.press('Meta+k')
  await expect(paletteDialog(page)).toBeVisible()
  await paletteDialog(page).getByRole('combobox').fill('Configure › Exec')
  await paletteDialog(page).getByRole('option', { name: 'Configure › Execution Environments' }).click()
  await expect(configurePane(page, 'Execution Environments')).toBeVisible()
  await expect(page).toHaveURL(/#\/configure\/execenvs$/)
})

test('below the narrow breakpoint the rail stacks above the pane', async ({ page }) => {
  // The sidebar is a drawer at this width, so the route is the way in.
  await page.setViewportSize({ width: 700, height: 900 })
  await gotoAppReady(page, '/#/configure/lists')
  await expect(configurePane(page, 'Lists')).toBeVisible()
  const nav = await configureKindNav(page).boundingBox()
  const pane = await configurePane(page, 'Lists').boundingBox()
  expect(nav && pane && pane.y >= nav.y + nav.height).toBe(true)
  expect(nav && nav.width).toBeGreaterThan(400)
})
