import { test, expect } from './fixtures/server'
import type { Page } from '@playwright/test'
import { findEmptyBoardPoint, placeNoteClear } from './fixtures/atlasEmptyRegion'
import { callBindingViaRPC } from './fixtures/wailsRpc'
import { clickBoardPoint, deleteSticky } from './fixtures/atlasBoard'

// Explicit save mode (goal 0295 S2b): Settings > General "Save changes:
// when I choose" makes a note's click-away HOLD its text (dirty
// marker, nothing written) until ⌘S or the leave sheet's Save all;
// quit / restart hold behind that sheet. Shared worker pool -- the
// mode is app-global, so every test here sets it and puts it back,
// and deletes the note it created. Restart is the observable leave in
// server mode (the handshake runs, then the updater reports itself
// unavailable), same as before-quit-flush.spec.ts.
const SETTINGS = 'github.com/alicoding/mill/internal/services/settingssvc.SettingsService'

async function setSaveMode(page: Page, mode: 'automatic' | 'explicit'): Promise<void> {
  // The RPC posts to the page's own origin -- it needs a loaded page.
  if (page.url() === 'about:blank') await page.goto('/')
  await callBindingViaRPC(page, `${SETTINGS}.SetSaveMode`, [mode])
}

async function openBoard(page: Page) {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()
  return board
}

// Focus on the engine's root AND the engine ready: its create() stamps
// the root's aria-label exactly when getMarkdown becomes readable, and
// a commit before that reads the debounced draft instead (goal 0296's
// residual under CPU throttle).
async function waitForEditorFocus(page: Page) {
  await expect
    .poll(() => page.evaluate(() => {
      const el = document.activeElement
      return el?.getAttribute('contenteditable') === 'true' && el.hasAttribute('aria-label')
    }))
    .toBe(true)
}

// A saved note whose second edit is HELD: created in one session (a
// draft's click-away creates it in either mode -- placement is the
// capture), then re-opened, extended, and clicked away from. Notes are
// found by a fragment that survives goal 0296's residual first-word
// loss under CPU throttle -- the text is never what these tests prove.
const fragment = (text: string) => text.split(' ').slice(1).join(' ')

async function createThenHoldNote(page: Page, saved: string, extra: string) {
  const board = await openBoard(page)
  await placeNoteClear(page, board)
  await waitForEditorFocus(page)
  await page.keyboard.insertText(saved) // atomic: the note's content is not what this proves
  await clickBoardPoint(page, await findEmptyBoardPoint(page, board))
  const note = page.getByTestId('atlas-sticky-note').filter({ hasText: fragment(saved) })
  await expect(note).toHaveAttribute('data-editing', 'false')

  await note.dblclick()
  await expect(note).toHaveAttribute('data-editing', 'true')
  await waitForEditorFocus(page)
  await page.keyboard.insertText(extra) // atomic, as above
  await clickBoardPoint(page, await findEmptyBoardPoint(page, board, [note]))
  await expect(note).toHaveAttribute('data-editing', 'false')
  await expect(note).toContainText(extra)
  await expect(note.getByTestId('unsaved-dot')).toBeVisible()
  return { board, note }
}

function requestRestart(page: Page): Promise<unknown> {
  return callBindingViaRPC(page, `${SETTINGS}.RestartApp`, []).catch(() => undefined)
}

test.afterEach(async ({ page }) => {
  await setSaveMode(page, 'automatic')
})

test('Settings > General offers the save mode and the caption follows the choice', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Settings' }).click()
  const control = page.getByTestId('save-mode-control')
  await expect(control).toBeVisible()
  await expect(page.getByTestId('save-mode-caption')).toHaveText('Edits save as you make them.')
  await control.getByText('When I choose', { exact: true }).click()
  await expect(page.getByTestId('save-mode-caption')).toHaveText('Edits wait until you press ⌘S. Mill asks before it quits or closes.')
  await expect.poll(() => callBindingViaRPC(page, `${SETTINGS}.GetSaveMode`, [])).toBe('explicit')
  await control.getByText('Automatically', { exact: true }).click()
  await expect.poll(() => callBindingViaRPC(page, `${SETTINGS}.GetSaveMode`, [])).toBe('automatic')
})

test('a held edit stays unwritten: the leave sheet appears on restart and Cancel keeps it held', async ({ page }) => {
  await setSaveMode(page, 'explicit')
  const { note } = await createThenHoldNote(page, 'Saved first cancel', 'plus held')

  const restart = requestRestart(page)
  const sheet = page.getByRole('alertdialog')
  await expect(sheet).toBeVisible()
  await expect(sheet).toContainText('Save changes before restarting?')
  await expect(page.getByTestId('unsaved-changes-body')).toHaveText("1 unsaved change will be lost if you don't save it.")
  await sheet.getByRole('button', { name: 'Cancel' }).click()
  await restart
  await expect(sheet).toHaveCount(0)
  await expect(note.getByTestId('unsaved-dot')).toBeVisible()

  // Never written: a reload shows only the saved text.
  await page.reload()
  await page.getByRole('link', { name: 'Atlas' }).click()
  const reloaded = page.getByTestId('atlas-sticky-note').filter({ hasText: fragment('Saved first cancel') })
  await expect(reloaded).toBeVisible()
  await expect(reloaded).not.toContainText('plus held')
  await deleteSticky(page, reloaded)
})

test('Save all on the leave sheet writes the held edit and lets the restart proceed', async ({ page }) => {
  await setSaveMode(page, 'explicit')
  const { note } = await createThenHoldNote(page, 'Saved first save', 'plus held')

  const restart = requestRestart(page)
  const sheet = page.getByRole('alertdialog')
  await expect(sheet).toBeVisible()
  await sheet.getByRole('button', { name: 'Save all' }).click()
  await restart
  await expect(sheet).toHaveCount(0)
  await expect(note.getByTestId('unsaved-dot')).toHaveCount(0)

  await page.reload()
  await page.getByRole('link', { name: 'Atlas' }).click()
  const reloaded = page.getByTestId('atlas-sticky-note').filter({ hasText: fragment('Saved first save') })
  await expect(reloaded).toContainText('plus held')
  await deleteSticky(page, reloaded)
})

test('⌘S while editing writes the note and keeps the session open', async ({ page }) => {
  await setSaveMode(page, 'explicit')
  const board = await openBoard(page)
  await placeNoteClear(page, board)
  await waitForEditorFocus(page)
  await page.keyboard.insertText('Saved by shortcut') // atomic, as above
  await clickBoardPoint(page, await findEmptyBoardPoint(page, board))
  const note = page.getByTestId('atlas-sticky-note').filter({ hasText: fragment('Saved by shortcut') })
  await expect(note).toHaveAttribute('data-editing', 'false')

  await note.dblclick()
  await waitForEditorFocus(page)
  await page.keyboard.insertText('and more ') // atomic, as above
  await expect(note.getByTestId('unsaved-dot')).toBeVisible()
  await page.keyboard.press('Meta+s')
  await expect(note.getByTestId('unsaved-dot')).toHaveCount(0)
  await expect(note).toHaveAttribute('data-editing', 'true')

  await page.reload()
  await page.getByRole('link', { name: 'Atlas' }).click()
  const reloaded = page.getByTestId('atlas-sticky-note').filter({ hasText: fragment('Saved by shortcut') })
  await expect(reloaded).toContainText('and more')
  await deleteSticky(page, reloaded)
})

test('automatic mode never asks: a restart with a live edit just commits it', async ({ page }) => {
  await setSaveMode(page, 'automatic')
  const board = await openBoard(page)
  await placeNoteClear(page, board)
  await waitForEditorFocus(page)
  await page.keyboard.insertText('Auto committed') // atomic, as above
  await requestRestart(page)
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await page.reload()
  await page.getByRole('link', { name: 'Atlas' }).click()
  const saved = page.getByTestId('atlas-sticky-note').filter({ hasText: fragment('Auto committed') })
  await expect(saved).toBeVisible()
  await deleteSticky(page, saved)
})
