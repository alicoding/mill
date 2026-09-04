import { test, expect } from './fixtures/server'

// The credential pre-flight (goal 0127 slice 3, owner live report):
// the seeded Confluence workflow's integration ships with no stored
// credential, so the canvas must say so BEFORE any run -- the amber
// will-fail warning naming the integration and the fix location --
// and Run must refuse with the same copy instead of failing mid-run.
// Shared worker pool: reads seeded state only, runs nothing to
// completion.
test('a missing integration credential surfaces at validation and refuses the run', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByText('Example: Confluence page → Markdown', { exact: true }).first().click()

  const panel = page.locator('[role="tabpanel"]:not([hidden])').last()
  // The validation chip counts the credential gap without any click.
  await expect(panel.getByText(/warning/)).toBeVisible()
  await panel.getByText(/warning/).click()
  await expect(page.getByText(/no credential saved on this device/)).toBeVisible()
  await expect(page.getByText(/Open it in Configure/)).toBeVisible()

  // Run refuses up front with the same copy -- never a mid-run
  // keychain error.
  await panel.getByTestId('canvas-run').click()
  await expect(panel.getByText('REFUSED')).toBeVisible()
  await expect(panel.getByText(/can't run yet/)).toBeVisible()
  // The bar truncates long refusals -- the integration's NAME must
  // survive the cut (the full copy was asserted in the panel above).
  await expect(panel.getByText(/Example: Confluence page \(PAT\)/).first()).toBeVisible()
})
