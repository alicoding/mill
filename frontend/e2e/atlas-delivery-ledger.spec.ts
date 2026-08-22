import { chromium, expect, test } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { workflowRow, activePanel } from './fixtures/canvas'
import { clickCanvasNode } from './fixtures/canvasNode'
import { waitForViewportStable } from './fixtures/animation'
import {
  ATLAS_LEDGER_SYNC_MCP_BASE_PORT,
  ATLAS_LEDGER_SYNC_SERVER_BASE_PORT,
  spawnMillServer,
  type SpawnedServer,
} from './fixtures/server'

// goal 0164 L1: the delivery-evidence ledger's own end-to-end proof --
// pointing the seeded "Example: Delivery ledger" workflow at a real
// frontmatter fixture folder produces a Delivered feature card whose
// sign-off field is genuinely editable in the live app, and a signoff
// change stamps a real verified date server-side. DEDICATED server
// pair: edits the seeded workflow's own folderPath config (global,
// shared-workflow state) and creates real Atlas cards, same own-
// server-own-ports reasoning as atlas-kind-authoring/atlas-linking.

// Same local-helper shape as composition.spec.ts/atlas-kind-authoring.spec.ts's
// own copies -- Fit View alone can still leave a node's card overlapping
// React Flow's fixed-position Controls/MiniMap chrome.
async function fitAndSpaceOut(page: import('@playwright/test').Page) {
  const panel = activePanel(page)
  await panel.getByRole('button', { name: 'Fit View' }).click()
  await waitForViewportStable(panel)
  await panel.getByRole('button', { name: 'Zoom Out' }).click()
  await waitForViewportStable(panel)
}

async function withServer(testInfo: { parallelIndex: number }, run: (page: Awaited<ReturnType<import('@playwright/test').Browser['newPage']>>) => Promise<void>): Promise<void> {
  const idx = testInfo.parallelIndex
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-ledger-sync-${idx}-`))
  let server: SpawnedServer | undefined
  const browser = await chromium.launch()
  try {
    server = await spawnMillServer({
      port: ATLAS_LEDGER_SYNC_SERVER_BASE_PORT + idx,
      mcpPort: ATLAS_LEDGER_SYNC_MCP_BASE_PORT + idx,
      settingsPath: path.join(dir, 'settings.json'),
      executionDbPath: path.join(dir, 'execution.db'),
      backupDir: path.join(dir, 'backups'),
    })
    const page = await browser.newPage()
    await page.goto(`${server.baseURL}/`)
    await page.getByRole('link', { name: 'Atlas' }).click()
    await expect(page.getByTestId('atlas-board')).toBeVisible()
    await run(page)
  } finally {
    await browser.close()
    await server?.stop()
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('pointing the seeded ledger-sync workflow at a fixture folder mirrors an editable, sign-off-preserving card', async ({}, testInfo) => {
  await withServer(testInfo, async (page) => {
    // A small real fixture: one goal file with a real frontmatter header.
    const fixtureDir = mkdtempSync(path.join(tmpdir(), 'mill-e2e-ledger-fixture-'))
    writeFileSync(path.join(fixtureDir, '9001-test-goal.md'), `---
id: "9001"
status: shipped
date: "2026-08-01"
prs: ["100"]
proof: ["TestFoo"]
spec_refs: ["1.1"]
---

# 9001 -- Test goal
`)

    // Point the seeded workflow's folder path at the fixture, then save.
    await page.getByRole('link', { name: 'Workflows' }).click()
    const ledgerRow = workflowRow(page, 'Example: Delivery ledger')
    await expect(ledgerRow).toBeVisible()
    await ledgerRow.click()
    await fitAndSpaceOut(page)
    // Reopening a saved workflow (built-in or not) lands in read-only
    // "Viewing" mode -- every field, including the canvas nodes' own
    // config inputs, stays disabled until Edit is pressed.
    await activePanel(page).getByRole('button', { name: 'Edit' }).click()
    await clickCanvasNode(page, activePanel(page), 'Mirror delivery ledger from a docs folder')
    await activePanel(page).getByLabel('Folder path').fill(fixtureDir)
    await activePanel(page).getByLabel('Folder path').blur()
    await activePanel(page).getByTestId('save-workflow').click()

    // Back to the list to run it -- reopening an existing workflow's
    // canvas keeps its own tab active, same as composition.spec.ts's
    // own "edit, then return to Workflows to Run" sequence.
    await page.getByRole('link', { name: 'Workflows' }).click()
    await ledgerRow.getByRole('button', { name: 'Run' }).click()
    const result = page.locator('[data-testid="workflow-run-result"]').filter({ has: page.getByText('Example: Delivery ledger', { exact: true }) })
    await expect(result).toBeVisible()
    await expect(result.locator('pre')).toBeVisible()

    // The mirrored card renders in Atlas, filed under "Delivered features"
    // -- a ROOT-level space (parentID "", same as docssync's own "Synced
    // docs" parent), a sibling of "The engagement" rather than a child of it,
    // so it only shows at "All spaces", not the default "The engagement" view.
    await page.getByRole('link', { name: 'Atlas' }).click()
    await page.getByRole('link', { name: 'All spaces' }).click()
    // A card holding children renders as its own region-frame node
    // (AtlasGroupNode), not the plain leaf atlas-note-card -- its own
    // "Zoom into {title}" button is the drill-in door (atlas-scale.spec.ts's
    // own precedent for a region chip).
    await page.getByRole('button', { name: 'Zoom into Delivered features' }).click()
    await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Delivered features')

    const mirrorCard = page.locator('[data-testid="atlas-note-card"]', { hasText: '9001 Test Goal' })
    await expect(mirrorCard).toBeVisible()
    await mirrorCard.click({ modifiers: ['Meta'] })
    const overlay = page.locator('[data-component="atlas-card-overlay"]')
    await expect(overlay).toBeVisible()

    // Mirror-owned fields carry the frontmatter's values, already
    // expanded (goal-0106's "a field with a value renders immediately").
    await expect(overlay.locator('[data-testid="atlas-field"][data-field-key="goalId"]')).toHaveValue('9001')
    await expect(overlay.locator('[data-testid="atlas-field"][data-field-key="shippedDate"]')).toHaveValue('2026-08-01')
    await expect(overlay.locator('[data-testid="atlas-field"][data-field-key="prs"]')).toHaveValue('100')
    await expect(overlay.locator('[data-testid="atlas-field"][data-field-key="proof"]')).toHaveValue('TestFoo')

    // Sign-off is genuinely editable: change it from the seeded default.
    const signoff = overlay.locator('[data-testid="atlas-field"][data-field-key="signoff"]')
    await expect(signoff).toHaveValue('pending-verify')
    await signoff.selectOption('verified')
    await expect(signoff).toHaveValue('verified')

    // Close the overlay BEFORE reloading -- Atlas session-restore
    // (goal 0091) re-opens whatever overlay was last recorded open on
    // the very next mount, and a still-open dialog's backdrop portal
    // then intercepts every subsequent click, hanging the test.
    //
    // Close via the BUTTON, not Escape: clicking it blurs the
    // auto-focused Title input, which commits a whole-card save. That
    // save carries the client's own Fields map, which never contained
    // the server-stamped verifiedAt -- so a save path that ignores the
    // response silently erases the stamp on the way out. Escape does
    // not blur the title and therefore cannot catch that class at all.
    await page.getByTestId('atlas-page-close').click()
    await expect(overlay).not.toBeVisible()

    // The server stamped a real verified date -- reload to read the
    // persisted card back deterministically, the same "reload to read
    // it back" discipline atlas-kind-authoring.spec.ts's own cardref
    // test uses after a server-side write.
    await page.reload()
    await page.getByRole('link', { name: 'Atlas' }).click()
    await page.getByRole('link', { name: 'All spaces' }).click()
    await page.getByRole('button', { name: 'Zoom into Delivered features' }).click()
    await page.locator('[data-testid="atlas-note-card"]', { hasText: '9001 Test Goal' }).click({ modifiers: ['Meta'] })
    const reopened = page.locator('[data-component="atlas-card-overlay"]')
    await expect(reopened).toBeVisible()
    await expect(reopened.locator('[data-testid="atlas-field"][data-field-key="signoff"]')).toHaveValue('verified')
    // A fresh mount (the reload) seeds its collapse state from the
    // now-non-empty value, so verifiedAt renders already-expanded --
    // no "+ Add Verified" click needed (AtlasCardPageFields.tsx's own
    // "a field with a value renders immediately" rule).
    await expect(reopened.locator('[data-testid="atlas-field"][data-field-key="verifiedAt"]')).toHaveValue(/^\d{4}-\d{2}-\d{2}$/)
    await page.keyboard.press('Escape')

    rmSync(fixtureDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  })
})
