import { test, expect } from './fixtures/server'
import { withClipboardLock } from './fixtures/clipboardLock'
import { openCard } from './fixtures/atlasBoard'

// goal 0063's share model -- card overlay + space toolbar share
// actions, proven against the seeded "Project charter" card (has a
// Source URL, a Contact field, and an incoming "relates to" link from
// "Ada Lovelace" -- builtin.go's own worked example) and its parent
// "Example area" space. Split out of atlas.spec.ts (architecture.md's
// 500-line convention) -- that file's own header covers the shared
// egocentric-root auto-entry behavior every test below relies on. The
// one-map board (goal 0072 slice A) retired the card chip's own quick-
// share menu (no slot in the ratified note-card anatomy) -- share now
// lives only in the card overlay's own Share section, reached by the
// click model's select-then-commit (goal 0102), and in the space
// toolbar's Share menu (both proven below). Real browser clipboard I/O
// (Playwright's clipboard-read/clipboard-write permissions), so every
// clipboard-touching section runs inside withClipboardLock -- same
// discipline quick-panel-clipboard-apply.spec.ts already established
// for navigator.clipboard, not just the Go osascript/pbcopy adapter.
// Deliberately never clicks a reveal-in-Finder action here: it shells
// out to the real OS file manager (BackupService.RevealBackupFolder's
// own mechanism, reused by RevealSpaceFolder/RevealCardMirror), the
// same reason goal 0065's own "Show in Finder" button has no e2e click
// coverage either -- Go-level tests (atlasservice_share_test.go) cover
// that behavior instead; e2e only asserts the action's presence.

// Precise per-card matching: aria-label carries the exact title.
function noteCard(page: import('@playwright/test').Page, title: string) {
  return page.locator(`[data-testid="atlas-note-card"][aria-label="Open ${title}"]`)
}

function groupCard(page: import('@playwright/test').Page, title: string) {
  return page.locator('[data-testid="atlas-group-card"]').filter({ has: page.locator(`[aria-label="Zoom into ${title}"]`) })
}

async function readClipboardText(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText())
}

// A share action's clipboard write happens after an async AtlasService
// round trip (fire-and-forget from the click handler's own point of
// view), so the clipboard's new content can lag a few ticks behind the
// click that requested it -- poll rather than read once immediately.
async function expectClipboardToContain(page: import('@playwright/test').Page, want: string): Promise<void> {
  await expect.poll(() => readClipboardText(page)).toContain(want)
}

test('the card overlay Share section copies context and the cloud link to the clipboard', async ({ page }) => {
  await withClipboardLock(async () => {
    await page.goto('/')
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.getByRole('link', { name: 'Atlas' }).click()
    await groupCard(page, 'Example area').getByTestId('atlas-group-header').click()
    await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Example area')

    const charterCard = noteCard(page, 'Project charter')
    await openCard(page, charterCard)
    const overlay = page.locator('[data-component="atlas-card-overlay"]')
    await expect(overlay).toBeVisible()

    await overlay.getByTestId('atlas-overlay-copy-context').click()
    await expectClipboardToContain(page, 'Project charter')
    const contextText = await readClipboardText(page)
    expect(contextText).toContain('Kind: Document')
    expect(contextText).toContain('Owner: Ada Lovelace')
    expect(contextText).toContain('Source: https://example.com/project-charter')

    await overlay.getByTestId('atlas-overlay-copy-link').click()
    await expect.poll(() => readClipboardText(page)).toBe('https://example.com/project-charter')

    await page.keyboard.press('Escape')
    await expect(overlay).not.toBeVisible()
  })
})

test('the space toolbar Share menu bundles the space as context and copies its links', async ({ page }) => {
  await withClipboardLock(async () => {
    await page.goto('/')
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.getByRole('link', { name: 'Atlas' }).click()
    await groupCard(page, 'Example area').getByTestId('atlas-group-header').click()
    await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Example area')

    await page.getByTestId('atlas-space-share').click()
    await expect(page.getByTestId('atlas-share-reveal-folder')).toBeVisible()
    await page.getByTestId('atlas-share-bundle-context').click()
    await expectClipboardToContain(page, 'Project charter')
    const bundleText = await readClipboardText(page)
    expect(bundleText).toContain('Ada Lovelace')
    expect(bundleText).toContain('---')

    await page.getByTestId('atlas-space-share').click()
    await page.getByTestId('atlas-share-copy-links').click()
    await expect.poll(() => readClipboardText(page)).toBe('https://example.com/project-charter')
  })
})
