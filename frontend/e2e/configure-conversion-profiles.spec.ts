// Conversion profiles (goal 0305 slice 6): the Configure entity choosing
// which rule sets an HTML-to-Markdown conversion applies, seeded with
// three examples, with a sample preview that runs one paste through
// every profile -- the Word check-box paste goal 0305 records is the
// sample. The
// converter step's Inspector picks a profile and Try this step honors
// it. Shared worker pool: assertions read only the seeded profiles and
// what this file creates and deletes.
import { test, expect } from './fixtures/server'
import { fillCodeEditor } from './fixtures/codeEditor'
import { clickCanvasNode } from './fixtures/canvasNode'
import { activePanel, dragPaletteItemToCanvas } from './fixtures/canvas'
import { stepOutput, tryStep } from './fixtures/stepTest'
import { clickRowAction } from './inventoryRow'

const rows = (page: import('@playwright/test').Page) => page.locator('[data-testid="inventory-row"][data-entity="conversionprofile"]')

const WORD_HTML = `<p><span style="font-family:Wingdings">þ</span> Tag the build</p><p><span style="font-family:Wingdings">q</span> Write the note</p>`

test('the seeded profiles are listed and the sample preview shows each profile\'s result side by side', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Conversion profiles' }).click()
  const pageRoot = page.getByTestId('configure-conversionprofiles')
  await expect(pageRoot).toBeVisible()
  await expect(rows(page).filter({ hasText: 'Example: Every rule set' })).toHaveCount(1)
  await expect(rows(page).filter({ hasText: 'Example: Plain HTML' })).toHaveCount(1)
  await expect(rows(page).filter({ hasText: 'Example: Confluence only' })).toHaveCount(1)

  await fillCodeEditor(page, 'conversion-sample-input', WORD_HTML)
  await pageRoot.getByTestId('conversion-sample-run').click()
  const every = pageRoot.locator('[data-testid="conversion-sample-result"][data-profile-id="conversionprofile-default"]')
  await expect(every.getByTestId('conversion-sample-output')).toContainText('- [x] Tag the build')
  await expect(every.getByTestId('conversion-sample-output')).toContainText('- [ ] Write the note')
  const plain = pageRoot.locator('[data-testid="conversion-sample-result"][data-profile-id="conversionprofile-plain"]')
  await expect(plain.getByTestId('conversion-sample-output')).toContainText('þ Tag the build')
})

test('a profile is created with chosen rule sets, edited, and deleted', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Conversion profiles' }).click()
  const pageRoot = page.getByTestId('configure-conversionprofiles')
  await pageRoot.getByTestId('new-conversionprofile').click()
  await pageRoot.getByTestId('conversionprofile-label').fill('Office pastes only')
  await pageRoot.getByTestId('conversionprofile-rule-confluence').uncheck()
  await expect(pageRoot.getByTestId('conversionprofile-rule-office')).toBeChecked()
  await pageRoot.getByTestId('save-conversionprofile').click()
  const row = rows(page).filter({ hasText: 'Office pastes only' })
  await expect(row).toBeVisible()
  await expect(row).toContainText('Office and Word')
  await expect(row).not.toContainText('Confluence')
  await row.click()
  await pageRoot.getByTestId('conversionprofile-label').fill('Office pastes renamed')
  await pageRoot.getByTestId('save-conversionprofile').click()
  const renamed = rows(page).filter({ hasText: 'Office pastes renamed' })
  await expect(renamed).toBeVisible()
  await clickRowAction(page, renamed, 'Delete')
  await expect(renamed).toHaveCount(0)
})

test('the converter step offers a Conversion profile and Try this step honors the chosen one', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByTestId('toggle-palette').click()
  await dragPaletteItemToCanvas(page, 'process-html-to-markdown')
  const panel = activePanel(page)
  await clickCanvasNode(page, panel, 'Convert HTML to Markdown')
  // With no profile chosen every rule set applies: the Word boxes
  // become task marks.
  const withEvery = await tryStep(page, panel, WORD_HTML)
  await expect(await stepOutput(withEvery)).toContainText('- [x] Tag the build')
  // Pick the plain profile: the glyph letter survives raw.
  await panel.getByTestId('entity-ref-field').selectOption({ label: 'Example: Plain HTML' })
  const withPlain = await tryStep(page, panel, WORD_HTML)
  await expect(await stepOutput(withPlain)).toContainText('þ Tag the build')
})
