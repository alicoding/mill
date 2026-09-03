import { test, expect } from './fixtures/server'
import { placeNoteClear } from './fixtures/atlasEmptyRegion'
import { callBindingViaRPC } from './fixtures/wailsRpc'
import { deleteSticky } from './fixtures/atlasBoard'

// The quit / restart handshake (goal 0295 S2): Go asks the page to
// flush its live edits before the process goes. Shared worker pool --
// the note created here is deleted at the end. The process exit itself
// is OS-bound; in server mode RestartApp runs the handshake and then
// reports the updater as unavailable, which is exactly the observable
// this needs: the edit must already be committed by then.
test('a sticky note still being edited is committed when Mill is asked to restart', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()

  await placeNoteClear(page, board)
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute('contenteditable') === 'true'))
    .toBe(true)
  await page.keyboard.insertText('Flush before restart') // atomic: the note's content is not what this proves

  // No click-away, no Escape: the note is mid-edit when the restart is
  // requested through the same RPC the Restart command calls.
  await callBindingViaRPC(page, 'github.com/alicoding/mill/internal/services/settingssvc.SettingsService.RestartApp', []).catch(() => undefined)

  // The commit landed server-side: a reload shows the note as a saved
  // sticky with that text.
  await page.reload()
  await page.getByRole('link', { name: 'Atlas' }).click()
  const saved = page.getByTestId('atlas-sticky-note').filter({ hasText: 'Flush before restart' })
  await expect(saved).toBeVisible()

  // Cleanup.
  await deleteSticky(page, saved)
  await expect(saved).toHaveCount(0)
})
