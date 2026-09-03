// The capture window (goal 0309): Mill's own note capture at its hash
// route -- the destination select lists the Scratchpad first, Save
// lands the note there, and the choice is remembered. Shared worker
// pool: this file reads only the notes it creates and deletes.
import { test, expect } from './fixtures/server'
import { callBindingViaRPC } from './fixtures/wailsRpc'
import { fillMilkdown } from './fixtures/codeEditor'

const ATLAS = 'github.com/alicoding/mill/internal/services/atlassvc.AtlasService.'
const SETTINGS = 'github.com/alicoding/mill/internal/services/settingssvc.SettingsService.'

test('a note captured away from the canvas lands in the chosen destination, and the choice is remembered', async ({ page }) => {
  await page.goto('/')
  await page.goto('about:blank')
  await page.goto('/#/capture?id=note')
  const window = page.getByTestId('capture-window')
  await expect(window).toBeVisible()
  await expect(window).toHaveAttribute('data-capture-id', 'note')
  const destination = page.getByTestId('capture-destination')
  await expect(destination).toHaveValue('atlas-card-scratchpad')
  await expect(page.getByTestId('capture-save')).toBeDisabled()

  await fillMilkdown(page, 'capture-note', 'ZzE2eCapturedThought')
  await destination.selectOption('')
  await page.getByTestId('capture-save').click()

  await expect.poll(async () => {
    const notes = await callBindingViaRPC<{ ID: string; Text: string; ParentID: string }[]>(page, ATLAS + 'Notes', [])
    return notes.find((n) => n.Text.includes('ZzE2eCapturedThought'))?.ParentID ?? 'missing'
  }).toBe('')
  const remembered = await callBindingViaRPC<Record<string, string>>(page, SETTINGS + 'GetCaptureDestinations', [])
  expect(remembered.note).toBe('')

  // Cleanup through the note's own delete.
  const notes = await callBindingViaRPC<{ ID: string; Text: string }[]>(page, ATLAS + 'Notes', [])
  for (const n of notes.filter((x) => x.Text.includes('ZzE2eCapturedThought'))) {
    await callBindingViaRPC(page, ATLAS + 'DeleteNote', [n.ID])
  }
  await callBindingViaRPC(page, SETTINGS + 'SetCaptureDestination', ['note', 'atlas-card-scratchpad'])
})

test('the capture route with no target says where a capture comes from', async ({ page }) => {
  await page.goto('about:blank')
  await page.goto('/#/capture')
  await expect(page.getByTestId('capture-no-target')).toContainText('Quick Panel')
})
