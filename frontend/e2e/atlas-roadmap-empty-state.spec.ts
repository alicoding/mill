import { chromium, expect, test } from '@playwright/test'
import { applyCpuThrottle } from './fixtures/throttle'
import type { FrameLocator, Locator, Page } from '@playwright/test'
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
//
// Roadmap is the bundled mill-roadmap plugin (goal 0357): its pane is
// a sandboxed iframe (PluginFrame), so every assertion into its content
// goes through a FrameLocator, never a plain page/pane Locator.

const ROADMAP_HOST_TESTID = 'plugin-view-mill-roadmap-roadmap'

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
    await applyCpuThrottle(page)
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
// "atlas-roadmap-cell" siblings after its own lane label (view.js's
// data-lane-key/data-bucket-key attributes).
function roadmapCell(frame: FrameLocator, laneLabelText: string, bucketKey: string): Locator {
  const lane = frame.getByTestId('atlas-roadmap-lane-label').filter({ hasText: laneLabelText })
  return lane.locator(`xpath=following-sibling::div[@data-bucket-key="${bucketKey}"][1]`)
}

// Native HTML5 drag-and-drop (the chip/cell handlers in the plugin's
// view.js, the same plain-dnd idiom DecisionRuleRow.tsx's own
// rule-reorder handle uses): Playwright's Locator.dragTo() never fires
// real dragstart/dragover/drop for a native-draggable element, so the
// two DragEvents are dispatched directly -- the identical, already-
// established pattern decision-rules-panel.spec.ts's dragRuleRow uses.
// Both locators resolve inside the SAME iframe document, so the
// DataTransfer stashed on that frame's own window survives the two
// evaluate() calls. Split into two calls (not one atomic script) so
// the browser gets a real event-loop turn between them, matching an
// actual gesture.
async function dragRoadmapChip(frame: FrameLocator, cardTitle: string, toCell: Locator): Promise<void> {
  await frame.getByTestId('atlas-roadmap-chip').filter({ hasText: cardTitle }).evaluate((chip) => {
    const dataTransfer = new DataTransfer()
    ;(window as unknown as { __e2eDragDataTransfer: DataTransfer }).__e2eDragDataTransfer = dataTransfer
    chip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }))
  })

  await toCell.evaluate((el) => {
    const dataTransfer = (window as unknown as { __e2eDragDataTransfer: DataTransfer }).__e2eDragDataTransfer
    el.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }))
    el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
  })
}

// Every plugin write is guarded (docs/goals/0357's edit-card-fields
// door rides the same guardrail plane content writes do), but a
// BUNDLED plugin's card-field write is decided by the seeded
// "Allow bundled extensions to edit card fields" rule (docs/goals/0357
// S1b): mill-roadmap's writes resolve immediately, with no pending
// action ever parked and nothing here to answer.

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('empty roadmap shows the skeleton + Place cards door; the picker auto-declares Horizon and drags move a chip between columns (goal 0225)', async ({}, testInfo) => {
  await withServer(testInfo, async (page) => {
    const cardTitle = 'ZzE2eRoadmapCard'
    const host = page.getByTestId(ROADMAP_HOST_TESTID)
    const frame = page.frameLocator(`[data-testid="${ROADMAP_HOST_TESTID}"]`)

    // "The engagement" root's own seeded children (Client records,
    // Discovery workstream, Scratchpad) are all Topic cards, and Topic
    // declares no horizon field yet -- the root roadmap starts
    // genuinely untagged, the real empty state a first-time user hits.
    await openToolbarAction(page, 'atlas-open-plugin-mill-roadmap-roadmap')
    await expect(host).toBeVisible()
    await expect(frame.getByTestId('atlas-roadmap-empty')).toHaveText('Place a card in Now, Next, or Then to start your roadmap.')
    await expect(frame.getByTestId('atlas-roadmap-grid')).toBeVisible()
    await expect(frame.getByTestId('atlas-roadmap-column-header')).toHaveText(['Now', 'Next', 'Then', 'Unscheduled'])
    await expect(frame.getByTestId('atlas-roadmap-place-cards-now')).toBeVisible()
    await expect(frame.getByTestId('atlas-roadmap-place-cards-next')).toBeVisible()
    await expect(frame.getByTestId('atlas-roadmap-place-cards-then')).toBeVisible()
    await expect(frame.getByTestId('atlas-roadmap-place-cards-unscheduled')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(host).not.toBeVisible()

    // A Topic card, whose Kind carries no horizon field -- the
    // picker's own "declare it first" path (contract item 2).
    await createCardViaTray(page, cardTitle, { kindID: ATLAS_KIND_TOPIC })
    await expect(noteCard(page, cardTitle)).toBeVisible()

    await openToolbarAction(page, 'atlas-open-plugin-mill-roadmap-roadmap')
    await expect(host).toBeVisible()

    // Two clicks, zero Kind-editor visits (Acceptance): open the Now
    // column's picker, pick the card.
    await frame.getByTestId('atlas-roadmap-place-cards-now').click()
    await frame.getByTestId('atlas-roadmap-picker-item').filter({ hasText: cardTitle }).click()

    // The quiet toast is the plugin's own pane-local rendering (its
    // page, inside the frame), the same surface the board itself uses.
    await expect(frame.getByTestId('atlas-quiet-toast')).toContainText('Added a Horizon field to Topic')
    const nowCell = roadmapCell(frame, 'Topic', 'now')
    await expect(nowCell.getByTestId('atlas-roadmap-chip').filter({ hasText: cardTitle })).toBeVisible()

    // The auto-declared field is visible in the Kind editor, never hidden.
    await page.keyboard.press('Escape')
    await expect(host).not.toBeVisible()
    await openToolbarAction(page, 'atlas-open-kinds')
    await page.getByTestId('atlas-kind-row').filter({ hasText: 'Topic' }).click()
    await expect(page.locator('input[data-testid="atlas-kind-field-key"][value="horizon"]')).toBeVisible()
    await page.keyboard.press('Escape')

    // Drag Now -> Then, persisted across a switch away from the view and back.
    await openToolbarAction(page, 'atlas-open-plugin-mill-roadmap-roadmap')
    await expect(host).toBeVisible()
    await dragRoadmapChip(frame, cardTitle, roadmapCell(frame, 'Topic', 'then'))
    await page.keyboard.press('Escape')
    await openToolbarAction(page, 'atlas-open-plugin-mill-roadmap-roadmap')
    await expect(roadmapCell(frame, 'Topic', 'then').getByTestId('atlas-roadmap-chip').filter({ hasText: cardTitle })).toBeVisible()
    await expect(roadmapCell(frame, 'Topic', 'now').getByTestId('atlas-roadmap-chip').filter({ hasText: cardTitle })).toHaveCount(0)

    // Drag to Unscheduled clears the tag, also persisted.
    await dragRoadmapChip(frame, cardTitle, roadmapCell(frame, 'Topic', 'unscheduled'))
    await page.keyboard.press('Escape')
    await openToolbarAction(page, 'atlas-open-plugin-mill-roadmap-roadmap')
    await expect(roadmapCell(frame, 'Topic', 'unscheduled').getByTestId('atlas-roadmap-chip').filter({ hasText: cardTitle })).toBeVisible()
    await expect(roadmapCell(frame, 'Topic', 'then').getByTestId('atlas-roadmap-chip').filter({ hasText: cardTitle })).toHaveCount(0)
    await page.keyboard.press('Escape')
  })
})
