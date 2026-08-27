import { test, expect } from './fixtures/server'
import { withClipboardLock } from './fixtures/clipboardLock'
import { writeHostClipboardText, hostClipboardAvailable } from './fixtures/hostClipboard'
import { paletteDialog } from './fixtures/palette'

// The coding loop end-to-end (docs/goals/0240 S1): copy a shell command
// block, hit the hotkey/palette, confirm the parsed structure, watch it
// run, copy the result back. Shared worker pool (not dedicated):
// assertions below are scoped to this test's own dialog/run, never a
// global Activity/run count (testing.md's shared-vs-dedicated rule),
// same choice codeexec.spec.ts already makes for the same reason.
//
// Drives the capture entry via the command palette (⌘K -> "Run from
// clipboard"), not the Quick Panel's own separate window -- the Quick
// Panel is a second, auxiliary Wails window Playwright's single-page
// harness doesn't attach to, while both doors render the exact same
// shared CodingLoopSurface/useCodingLoopRun (shared/CodingLoopSurface.tsx),
// so the palette path already exercises the real state machine end to
// end; the Quick Panel's OWN wiring (the door hook, the rich row) is
// proven structurally by quickPanelCommands.test.ts instead (unit
// layer, testing.md's layering).
//
// Real clipboard, no seam: CompositionService.ReadHostClipboardText
// reads the actual OS pasteboard (pbpaste) with no test-injectable
// override, so this uses the real clipboard via withClipboardLock +
// fixtures/hostClipboard.ts, same as quick-panel-clipboard-apply.spec.ts
// -- there is no seam to prefer here. On CI's headless ubuntu-latest
// runner (no pbcopy/pbpaste), the RPC read itself fails; that spec's
// own precedent is asserted here too (the honest error path), not a
// payload round-trip the runner's OS can't perform.
//
// Live-run class (QUARANTINE.md): this fires a real workflow run and
// waits for its own terminal status before any cleanup.

test('Coding loop: capture, confirm, run, and copy back the result', async ({ page }) => {
  await withClipboardLock(async () => {
    writeHostClipboardText('echo coding-loop-e2e-one\necho coding-loop-e2e-two')

    await page.goto('/')
    await expect(page.getByRole('link', { name: 'Home' })).toBeVisible()

    await page.keyboard.press('Meta+K')
    await expect(paletteDialog(page)).toBeVisible()
    await paletteDialog(page).getByRole('combobox').fill('run from clipboard')
    await paletteDialog(page).getByRole('option', { name: 'Run from clipboard…', exact: true }).click()

    const dialog = page.getByRole('dialog', { name: 'Run from clipboard' })
    await expect(dialog).toBeVisible()

    if (!hostClipboardAvailable) {
      // The honest never-silent failure path (no real pasteboard on
      // this runner) -- see this file's own header comment.
      await expect(page.getByTestId('coding-loop-read-error')).toBeVisible({ timeout: 10_000 })
      return
    }

    // --- Confirm: the parsed structure is visible before anything runs ---
    const confirm = page.getByTestId('coding-loop-confirm')
    await expect(confirm).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('coding-loop-confirm-summary')).toContainText('2 steps')
    const steps = page.getByTestId('coding-loop-confirm-steps').locator('li')
    await expect(steps).toHaveCount(2)
    await expect(steps.nth(0)).toContainText('echo coding-loop-e2e-one')
    await expect(steps.nth(1)).toContainText('echo coding-loop-e2e-two')
    await expect(page.getByTestId('coding-loop-confirm-verdict')).toContainText('Asks for approval')

    // --- Run: the Confirm click is the approval gesture ---
    await page.getByTestId('coding-loop-confirm-run').click()

    // --- Running: per-step state, never stuck ---
    await expect(page.getByTestId('coding-loop-running')).toBeVisible({ timeout: 10_000 })

    // --- Result: full output, saved as a run record ---
    const result = page.getByTestId('coding-loop-result')
    await expect(result).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('coding-loop-result-output')).toContainText('coding-loop-e2e-one')
    await expect(page.getByTestId('coding-loop-result-output')).toContainText('coding-loop-e2e-two')

    // --- Copy result: one click, the real clipboard now holds it ---
    await page.getByTestId('coding-loop-result-copy').click()
    await expect(page.getByTestId('coding-loop-result-copy')).toContainText('Copied')
  })
})

// The allow/deny pattern-list verdict display (docs/goals/0240 S3): a
// block mixing an allow-listed read-only line (ls) with a deny-listed
// dangerous one (rm -rf) shows EACH step's own guardrail verdict on the
// Confirm screen, distinctly from the plain default-ask copy an
// unlisted command (the spec above's echo lines) gets. Only reaches
// Confirm -- running the deny-listed line for real is already proven at
// the Go layer (executionsvc/codingloop_shellguard_test.go); this spec
// is the presentation layer the Go tests can't express.
test('Coding loop: Confirm shows an allow-listed and a deny-listed step verdict', async ({ page }) => {
  await withClipboardLock(async () => {
    writeHostClipboardText('ls\nrm -rf /tmp/coding-loop-e2e-does-not-exist')

    await page.goto('/')
    await expect(page.getByRole('link', { name: 'Home' })).toBeVisible()

    await page.keyboard.press('Meta+K')
    await expect(paletteDialog(page)).toBeVisible()
    await paletteDialog(page).getByRole('combobox').fill('run from clipboard')
    await paletteDialog(page).getByRole('option', { name: 'Run from clipboard…', exact: true }).click()

    const dialog = page.getByRole('dialog', { name: 'Run from clipboard' })
    await expect(dialog).toBeVisible()

    if (!hostClipboardAvailable) {
      await expect(page.getByTestId('coding-loop-read-error')).toBeVisible({ timeout: 10_000 })
      return
    }

    const confirm = page.getByTestId('coding-loop-confirm')
    await expect(confirm).toBeVisible({ timeout: 10_000 })
    const steps = page.getByTestId('coding-loop-confirm-steps').locator('li')
    await expect(steps).toHaveCount(2)

    await expect(page.getByTestId('coding-loop-confirm-step-verdict-0')).toContainText('Allowed by "Read-only: ls"')
    await expect(page.getByTestId('coding-loop-confirm-step-verdict-1')).toContainText('Blocked by "Destructive: rm -rf". Approve to run.')

    // The block still needs approval overall (the deny-listed line wins
    // the block-level decision) -- never silently skipped just because
    // one line was allow-listed.
    await expect(page.getByTestId('coding-loop-confirm-verdict')).toContainText('Asks for approval')
  })
})
