import { test, expect } from './fixtures/server'
import { withClipboardLock } from './fixtures/clipboardLock'
import { openConfigureKind } from './fixtures/configureNav'

// The copyable-diagnosis sweep (goal 0127 slice 4): two representative
// surfaces of the seven wired to shared/CopyDiagnosisButton, proving
// the composed payload (error + context lines + the app diagnostics
// block) actually lands on the clipboard, not just that the button
// renders.
//
// Both reads go through navigator.clipboard (Playwright's
// clipboard-read/-write context permissions), not the real macOS
// pasteboard -- Mill's own clipboard-touching NODES
// (capture-clipboard-*/apply-clipboard-write-*) are what
// fixtures/clipboardLock.ts's header comment scopes the OS-pasteboard
// lock to. This suite still takes the lock: atlas-share.spec.ts and
// quick-panel-clipboard-apply.spec.ts already found, empirically, that
// Playwright's granted clipboard-read/-write permission reads/writes
// the real system clipboard on this platform too (not a sandboxed
// virtual one) -- the same real-OS-resource contention risk under
// parallel workers, so the same lock applies here.

async function readClipboardText(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText())
}

test('the refused-run finished bar copies the full error plus run context and app diagnostics', async ({ page }) => {
  await withClipboardLock(async () => {
    await page.goto('/')
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.getByRole('link', { name: 'Workflows' }).click()
    await page.getByText('Example: Confluence page → Markdown', { exact: true }).first().click()

    const panel = page.locator('[role="tabpanel"]:not([hidden])').last()
    await panel.getByTestId('canvas-run').click()
    await expect(panel.getByText('REFUSED')).toBeVisible()

    await panel.getByTestId('canvas-run-copy-diagnosis').click()
    await expect.poll(() => readClipboardText(page)).toContain("can't run yet")
    const clipboard = await readClipboardText(page)
    // A pre-flight refusal never reaches a real run -- no run/workflow
    // identity to report, just the refusal and the app's own block.
    expect(clipboard).toContain('proxy')
  })
})

test("an MCP server save error copies the validation message plus the form's label/command and app diagnostics", async ({ page }) => {
  await withClipboardLock(async () => {
    await page.goto('/')
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.getByRole('link', { name: 'Configure' }).click()
    await openConfigureKind(page, 'MCP Servers')
    await page.getByTestId('new-mcpserver').click()
    await page.getByLabel('Label').fill('E2E diagnosis probe')
    // Command left empty -- mcpserver.Validate refuses before
    // anything is persisted, the cheapest deterministic save-error
    // fixture available (no server created, nothing to clean up).
    await page.getByRole('button', { name: 'Save MCP server' }).click()
    await expect(page.getByText('an MCP server needs a command')).toBeVisible()

    await page.getByTestId('mcpserver-save-copy-diagnosis').click()
    await expect.poll(() => readClipboardText(page)).toContain('an MCP server needs a command')
    const clipboard = await readClipboardText(page)
    expect(clipboard).toContain('Server label: E2E diagnosis probe')
    // Command was left empty -- the secrets-adjacent-but-not-actually-
    // secret Command context line is simply absent, never a blank one.
    expect(clipboard).not.toContain('Command: \n')
    expect(clipboard).toContain('proxy')
  })
})
