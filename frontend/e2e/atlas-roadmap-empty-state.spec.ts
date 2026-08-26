import { chromium, expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { openToolbarAction } from './fixtures/toolbarActions'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  ATLAS_ROADMAP_EMPTY_STATE_MCP_BASE_PORT, ATLAS_ROADMAP_EMPTY_STATE_SERVER_BASE_PORT, spawnMillServer, type SpawnedServer,
} from './fixtures/server'
import { ATLAS_KIND_TOPIC } from './fixtures/kindPicker'
import { createCardViaTray, noteCard } from './fixtures/atlasBoard'

// The Roadmap view's empty state (docs/goals/0225, defect class
// dead-end-instruction): a sentence naming an action needs the
// affordance to do it beside it, in the same view. DEDICATED server
// pair, not the shared pool -- the picker's own auto-declare path
// writes a new Field onto a Kind (Topic, here), global vocabulary
// every OTHER test's board render and kind picker also reads
// (testing.md's shared-vs-dedicated rule, same reasoning
// atlas-kind-authoring.spec.ts's own header already states).

async function withServer(testInfo: { parallelIndex: number }, run: (page: Page) => Promise<void>): Promise<void> {
  const idx = testInfo.parallelIndex
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-roadmap-empty-${idx}-`))
  let server: SpawnedServer | undefined
  const browser = await chromium.launch()
  try {
    server = await spawnMillServer({
      port: ATLAS_ROADMAP_EMPTY_STATE_SERVER_BASE_PORT + idx,
      mcpPort: ATLAS_ROADMAP_EMPTY_STATE_MCP_BASE_PORT + idx,
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

// Locates a specific lane's own cell for one bucket -- the grid is a
// flat CSS grid, so a lane's own 4 cells are simply the next 4
// "atlas-roadmap-cell" siblings after its own lane label
// (AtlasRoadmapView.tsx's data-lane-key/data-bucket-key attributes).
function roadmapCell(dialog: Locator, laneLabelText: string, bucketKey: string): Locator {
  const lane = dialog.getByTestId('atlas-roadmap-lane-label').filter({ hasText: laneLabelText })
  return lane.locator(`xpath=following-sibling::div[@data-bucket-key="${bucketKey}"][1]`)
}

// Native HTML5 drag-and-drop (RoadmapChip/RoadmapLaneRow, the same
// plain-dnd idiom DecisionRuleRow.tsx's own rule-reorder handle uses):
// Playwright's Locator.dragTo() never fires real dragstart/dragover/
// drop for a native-draggable element, so the two DragEvents are
// dispatched directly -- the identical, already-established pattern
// decision-rules-panel.spec.ts's dragRuleRow uses. Split into two
// page.evaluate calls (not one atomic script) so the browser gets a
// real event-loop turn between them, matching an actual gesture.
async function dragRoadmapChip(page: Page, cardTitle: string, toCell: Locator): Promise<void> {
  await page.evaluate((title) => {
    const chip = Array.from(document.querySelectorAll('[data-testid="atlas-roadmap-chip"]'))
      .find((el) => el.textContent?.includes(title))
    if (!chip) throw new Error(`dragRoadmapChip: no chip for ${title}`)
    const dataTransfer = new DataTransfer()
    ;(window as unknown as { __e2eDragDataTransfer: DataTransfer }).__e2eDragDataTransfer = dataTransfer
    chip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }))
  }, cardTitle)

  await toCell.evaluate((el) => {
    const dataTransfer = (window as unknown as { __e2eDragDataTransfer: DataTransfer }).__e2eDragDataTransfer
    el.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }))
    el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
  })
}

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('empty roadmap shows the skeleton + Place cards door; the picker auto-declares Horizon and drags move a chip between columns (goal 0225)', async ({}, testInfo) => {
  await withServer(testInfo, async (page) => {
    const cardTitle = 'ZzE2eRoadmapCard'
    const dialog = page.locator('[data-component="atlas-roadmap-dialog"]')

    // "The engagement" root's own seeded children (Client records,
    // Discovery workstream, Scratchpad) are all Topic cards, and Topic
    // declares no horizon field yet -- the root roadmap starts
    // genuinely untagged, the real empty state a first-time user hits.
    await openToolbarAction(page, 'atlas-open-roadmap')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('atlas-roadmap-empty')).toHaveText('Place a card in Now, Next, or Then to start your roadmap.')
    await expect(dialog.getByTestId('atlas-roadmap-grid')).toBeVisible()
    await expect(dialog.getByTestId('atlas-roadmap-column-header')).toHaveText(['Now', 'Next', 'Then', 'Unscheduled'])
    await expect(dialog.getByTestId('atlas-roadmap-place-cards-now')).toBeVisible()
    await expect(dialog.getByTestId('atlas-roadmap-place-cards-next')).toBeVisible()
    await expect(dialog.getByTestId('atlas-roadmap-place-cards-then')).toBeVisible()
    await expect(dialog.getByTestId('atlas-roadmap-place-cards-unscheduled')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()

    // A Topic card, whose Kind carries no horizon field -- the
    // picker's own "declare it first" path (contract item 2).
    await createCardViaTray(page, cardTitle, { kindID: ATLAS_KIND_TOPIC })
    await expect(noteCard(page, cardTitle)).toBeVisible()

    await openToolbarAction(page, 'atlas-open-roadmap')
    await expect(dialog).toBeVisible()

    // Two clicks, zero Kind-editor visits (Acceptance): open the Now
    // column's picker, pick the card.
    await dialog.getByTestId('atlas-roadmap-place-cards-now').click()
    await page.getByTestId('atlas-roadmap-picker-item').filter({ hasText: cardTitle }).click()

    await expect(page.getByTestId('atlas-quiet-toast')).toContainText('Added a Horizon field to Topic')
    const nowCell = roadmapCell(dialog, 'Topic', 'now')
    await expect(nowCell.getByTestId('atlas-roadmap-chip').filter({ hasText: cardTitle })).toBeVisible()

    // The auto-declared field is visible in the Kind editor, never hidden.
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await openToolbarAction(page, 'atlas-open-kinds')
    await page.getByTestId('atlas-kind-row').filter({ hasText: 'Topic' }).click()
    await expect(page.locator('input[data-testid="atlas-kind-field-key"][value="horizon"]')).toBeVisible()
    await page.keyboard.press('Escape')

    // Drag Now -> Then, persisted across a close/reopen of the dialog.
    await openToolbarAction(page, 'atlas-open-roadmap')
    await expect(dialog).toBeVisible()
    await dragRoadmapChip(page, cardTitle, roadmapCell(dialog, 'Topic', 'then'))
    await page.keyboard.press('Escape')
    await openToolbarAction(page, 'atlas-open-roadmap')
    await expect(roadmapCell(dialog, 'Topic', 'then').getByTestId('atlas-roadmap-chip').filter({ hasText: cardTitle })).toBeVisible()
    await expect(roadmapCell(dialog, 'Topic', 'now').getByTestId('atlas-roadmap-chip').filter({ hasText: cardTitle })).toHaveCount(0)

    // Drag to Unscheduled clears the tag, also persisted.
    await dragRoadmapChip(page, cardTitle, roadmapCell(dialog, 'Topic', 'unscheduled'))
    await page.keyboard.press('Escape')
    await openToolbarAction(page, 'atlas-open-roadmap')
    await expect(roadmapCell(dialog, 'Topic', 'unscheduled').getByTestId('atlas-roadmap-chip').filter({ hasText: cardTitle })).toBeVisible()
    await expect(roadmapCell(dialog, 'Topic', 'then').getByTestId('atlas-roadmap-chip').filter({ hasText: cardTitle })).toHaveCount(0)
    await page.keyboard.press('Escape')
  })
})
