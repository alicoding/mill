import { test, expect } from './fixtures/server'
import { withClipboardLock } from './fixtures/clipboardLock'

// Split out of composition.spec.ts once it crossed the 500-line limit
// (CLAUDE.md), same "split along a real seam" discipline that already
// produced composition-canvas-interactions.spec.ts and
// composition-export-import.spec.ts -- see composition.spec.ts's own
// header comment. This file's seam: running Mill's SEEDED, built-in
// workflows via the list page and checking the result, as opposed to
// composing/editing a workflow from scratch (which stays in
// composition.spec.ts).
//
// Real Go bindings over HTTP (Wails3 server mode), not mocks. Every
// test here touches the real OS clipboard somewhere in its seed's node
// chain, so every result assertion is deliberately environment-
// independent (docs/SPEC.md §1.3): a clipboard write/read errors on
// every call on a headless Linux CI runner (no osascript/pbpaste), so
// these assert that a run produced SOME visible result (success or
// error), or check a specific step's own recorded output instead of
// the workflow's clipboard-dependent terminal result.

function workflowRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="workflow"]', { has: page.getByText(label, { exact: true }) })
}

// A run's result renders below the InventoryList (docs/goals/0007's
// dense-row anatomy has no room for a result preview) -- scoped by the
// same label match.
function runResult(page: import('@playwright/test').Page, label: string) {
  return page.getByTestId('workflow-run-result').filter({ has: page.getByText(label, { exact: true }) })
}

// Real OS clipboard I/O (goal 0009: frontend/e2e/fixtures/clipboardLock.ts) --
// the whole test body runs under the cross-process lock since it both
// writes to and reads the one shared real pasteboard.
test('Running the load-sample workflow produces a visible response, success or error', async ({ page }) => {
  await withClipboardLock(async () => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await workflowRow(page, 'Load sample HTML').getByRole('button', { name: 'Run' }).click()
  // Asserts the full click -> Go binding -> render pipeline produces
  // SOME response, without hard-coding osascript's platform-specific
  // text (the result content is clipboard-dependent). Scoped to the
  // result container itself, not `.locator('pre')` -- CompositionView.tsx
  // only renders a <pre> on the success branch; an error (e.g. no
  // osascript on Linux, docs/SPEC.md §1.3) renders as plain error text
  // in the same container instead, which is exactly the "success or
  // error" this test's own name promises.
  await expect(runResult(page, 'Load sample HTML')).toBeVisible()
  })
})

// Real OS clipboard I/O (goal 0009) -- same lock as above.
test('Running the clipboard-to-markdown workflow produces a visible response, success or error', async ({ page }) => {
  await withClipboardLock(async () => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await workflowRow(page, 'Clipboard → Markdown').getByRole('button', { name: 'Run' }).click()
  // The result is clipboard-dependent (real HTML converts; no HTML
  // falls back to plain text per SPEC §5; an empty clipboard errors,
  // and on Linux there's no osascript/pbpaste at all -- docs/SPEC.md
  // §1.3) -- so this asserts the pipeline rendered SOME result, not a
  // specific outcome. Scoped to the result container itself, not
  // `.locator('pre')`, which only renders on the success branch (see
  // the load-sample test above for the same fix).
  await expect(runResult(page, 'Clipboard → Markdown')).toBeVisible()
  })
})

test('Saved-page seed: a manual test run substitutes the trigger payload via the Run dialog', async ({ page }) => {
  // The live failure this covers: the seed's capture-file reads its
  // path from the payload the filesystem-watch trigger normally
  // supplies -- a manual Run used to start empty-payloaded and die at
  // capture-file with a bare error. The Run dialog now opens even with
  // zero Attributes when the trigger supplies the input
  // (triggerPayload.ts), offering an Initial-payload field. The spec
  // and the server run on the same machine, so a spec-written temp
  // file is a real, readable path for the server.
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mill-e2e-payload-'))
  const file = path.join(dir, 'page.html')
  fs.writeFileSync(file, '<nav>chrome nav</nav><main id="main-content"><h1>Captured Title</h1></main>')

  // The seed's final step writes the REAL clipboard -- serialize
  // through the shared lock (.claude/rules/testing.md).
  await withClipboardLock(async () => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Workflows' }).click()
    const row = workflowRow(page, 'Example: Saved page → Markdown')
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: 'Run Example: Saved page → Markdown', exact: true }).click()

    const payloadField = page.getByTestId('test-run-payload')
    await expect(payloadField).toBeVisible()
    await payloadField.fill(file)
    await page.getByRole('button', { name: 'Run', exact: true }).click()

    // The seed's LAST step (apply-clipboard-write-text) needs a real OS
    // clipboard (pbcopy on macOS), which errors on every call on a
    // headless Linux CI runner (docs/SPEC.md §1.3) -- so the whole
    // run's own terminal result on this list page is just that error
    // there, not the extracted content. What this test actually proves
    // -- that the Initial-payload field threads through to capture-file,
    // and extraction keeps the main content while dropping nav chrome --
    // is independent of that clipboard step, so it's checked at the
    // per-step level (the "Process: HTML → Markdown" step's own
    // recorded output, via the workflow's Runs tab) instead of the
    // terminal result.
    await expect(page.getByTestId('workflow-run-result')).toBeVisible({ timeout: 15_000 })

    await row.click()
    await page.getByRole('tab', { name: 'Runs' }).click()
    await page.getByTestId('runs-table').locator('tbody tr').first().click()
    const markdownStep = page.getByTestId('run-detail').getByTestId('run-step').filter({ has: page.getByText('Process: HTML → Markdown', { exact: true }) })
    await expect(markdownStep).toContainText('Captured Title', { timeout: 15_000 })
    await expect(markdownStep).not.toContainText('chrome nav')
  })
  fs.rmSync(dir, { recursive: true, force: true })
})
