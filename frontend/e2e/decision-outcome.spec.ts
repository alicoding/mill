import { test, expect } from './fixtures/server'
import { waitForViewportStable } from './fixtures/animation'
import { clickRowAction } from './inventoryRow'
import { workflowRow, activePanel } from './fixtures/canvas'

// Decision as a reusable, typed TERMINAL outcome (docs/adr/0027),
// driven through the live app: Configure > Decisions CRUD (including
// the category-immutability UI), and the two seeded workflows that
// prove the routing-vs-terminal split end to end -- "Example: Branch to
// a decision" (a Branch node routes to one of two Decisions, a typed
// value flows into the reached outcome) and "Example: Decision with
// review" (a manual-review Decision parks in the Review queue before
// terminalizing). The seed IS the proof (.claude/rules/testing.md).

function decisionRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="decision"]').filter({ has: page.getByText(label, { exact: true }) })
}

async function openDecisionsTab(page: import('@playwright/test').Page) {
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Decisions' }).click()
  await expect(page.getByTestId('configure-decisions')).toBeVisible()
}

test('Configure > Decisions: create shows the immutability caption, edit disables category, delete cleans up', async ({ page }) => {
  await page.goto('/')
  await openDecisionsTab(page)

  await page.getByTestId('new-decision').click()
  // The create-time category control is a live Select with a caption
  // naming the immutability rule up front, not a surprise at edit time.
  await expect(page.getByText('Fixed once created', { exact: false })).toBeVisible()
  const categorySelect = page.getByTestId('decision-category')
  await expect(categorySelect).toBeEnabled()

  const label = 'E2E test decision'
  await page.getByLabel('Label').fill(label)
  await categorySelect.selectOption('deny')
  await page.getByTestId('save-decision').click()

  const row = decisionRow(page, label)
  await expect(row).toBeVisible()
  await expect(row).toContainText('Deny')

  // Edit: row click opens the edit form (InventoryList's onOpen,
  // docs/goals/0007) -- the category control is now disabled, same
  // caption visible.
  await row.click()
  await expect(page.getByTestId('decision-category')).toBeDisabled()
  await expect(page.getByText('Fixed once created', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()

  await clickRowAction(page, row, 'Delete')
  await expect(decisionRow(page, label)).toHaveCount(0)
})

// docs/adr/0040 decisions 4-5, driven end to end: Publish freezes an
// immutable numbered version, shown in the edit form's own Versions
// section.
test('Configure > Decisions: Publish freezes a version, shown in the version list', async ({ page }) => {
  await page.goto('/')
  await openDecisionsTab(page)

  await page.getByTestId('new-decision').click()
  await page.getByLabel('Label').fill('E2E publish decision')
  await page.getByTestId('decision-category').selectOption('deny')
  await page.getByTestId('save-decision').click()

  const row = decisionRow(page, 'E2E publish decision')
  await expect(row).toBeVisible()
  await row.click()

  await expect(page.getByTestId('decision-published-badge')).toContainText('Never published')
  await expect(page.getByTestId('decision-versions-list')).toHaveCount(0)

  await page.getByTestId('publish-decision').click()
  await expect(page.getByTestId('decision-published-badge')).toContainText('Published v1')
  await expect(page.getByTestId('decision-versions-list')).toContainText('v1')

  await page.getByRole('button', { name: 'Cancel' }).click()
  await clickRowAction(page, row, 'Delete')
  await expect(decisionRow(page, 'E2E publish decision')).toHaveCount(0)
})

function stepDetailOverlay(page: import('@playwright/test').Page) {
  return page.locator('[data-component="step-detail-overlay"]')
}

async function runBranch(page: import('@playwright/test').Page, panel: import('@playwright/test').Locator, amount: string) {
  await panel.getByTestId('canvas-run').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Amount').fill(amount)
  await dialog.getByRole('button', { name: 'Run' }).click()
  await expect(panel.getByTestId('run-state-dock')).toContainText('SUCCESS', { timeout: 15_000 })
}

// Double-clicks the reached terminal (DONE) card at a point proven
// (via elementFromPoint) to land inside the node's own card -- see
// step-detail-overlay.spec.ts's identical helper for the full
// reasoning: React Flow's fixed-position MiniMap/Controls chrome can
// sit on top of a node's naive center point depending on the graph's
// current pan/zoom, which a plain locator.dblclick() doesn't account
// for.
async function dblClickReachedTerminal(page: import('@playwright/test').Page, panel: import('@playwright/test').Locator) {
  const node = panel.locator('.react-flow__node').filter({ hasText: 'Decision' }).filter({ hasText: 'DONE' }).first()
  await expect(node).toBeVisible({ timeout: 10_000 })
  // The reached terminal is the bottom-most card, where the run bar and
  // the minimap overlay the canvas; on a runner whose header wraps
  // taller, every probe point can land on an overlay. Zoom out (the
  // canvas kit's own control, cards shrink toward the center) and
  // re-measure before giving up (goal 0296's register re-run).
  for (let attempt = 0; attempt < 3; attempt++) {
    const box = await node.boundingBox()
    if (!box) throw new Error('dblClickReachedTerminal: reached terminal card has no bounding box')
    const candidates = [
      { x: box.x + 10, y: box.y + 10 },
      { x: box.x + box.width - 10, y: box.y + 10 },
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      { x: box.x + 10, y: box.y + box.height - 10 },
    ]
    for (const point of candidates) {
      const insideNode = await page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y)
        return !!el?.closest('.react-flow__node')
      }, point)
      if (insideNode) {
        await node.dblclick({ position: { x: point.x - box.x, y: point.y - box.y } })
        return
      }
    }
    await panel.getByRole('button', { name: 'Zoom Out' }).click()
    await waitForViewportStable(panel)
  }
  throw new Error('dblClickReachedTerminal: no point resolved inside the reached terminal card')
}

// The regression docs/goals/0046 itself demands, driven through the
// live app: pinning a decision-outcome node to a published version
// keeps resolving that frozen definition after the live Decision
// changes, and the run's own recorded output stamps which definition
// it used (docs/adr/0040 decisions 4-5).
test('Branch to a decision: the pinned approve arm ignores a later live edit; run output stamps pinned vs live', async ({ page }) => {
  await page.goto('/')
  await openDecisionsTab(page)

  // Edit the live "Approve (example)" Decision -- an additive output
  // field, allowed in place (docs/adr/0040 decision 1). The seeded
  // workflow's approve arm is pinned to v1, published before this edit.
  const approveRow = decisionRow(page, 'Approve (example)')
  await expect(approveRow).toBeVisible()
  await approveRow.click()
  await expect(page.getByTestId('decision-published-badge')).toContainText('Published v1')
  await page.getByRole('button', { name: 'Add output' }).click()
  const newOutputRow = page.locator('[data-testid="decision-output-row"]').last()
  await newOutputRow.getByPlaceholder('key').fill('e2eLiveField')
  await newOutputRow.getByPlaceholder('label').fill('E2E live field')
  await page.getByTestId('save-decision').click()

  await page.getByRole('link', { name: 'Workflows' }).click()
  const wfRow = workflowRow(page, 'Example: Branch to a decision')
  await expect(wfRow).toBeVisible()
  await wfRow.click()
  const panel = activePanel(page)
  await expect(panel.locator('.react-flow__node').first()).toBeVisible()

  // PINNED arm (amount > 100): the run must reflect v1's frozen shape,
  // never the field just added to the live draft.
  await runBranch(page, panel, '150')
  await dblClickReachedTerminal(page, panel)
  const overlay = stepDetailOverlay(page)
  await expect(overlay).toBeVisible()
  // The recorded payload is JSON, so it presents as a tree (goal 0326):
  // the pinned value is a row of its own, and Raw still holds the exact
  // bytes the step emitted.
  const output = overlay.getByTestId('step-detail-output-payload')
  await expect(output.getByTestId('json-tree-leaf').filter({ hasText: 'resolvedVersion' })).toContainText('"v1"')
  await expect(output).not.toContainText('e2eLiveField')
  await output.getByTestId('output-view-raw').click()
  await expect(output.getByTestId('step-detail-output-payload-raw')).toContainText('"resolvedVersion":"v1"')
  await page.keyboard.press('Escape')
  await expect(overlay).toHaveCount(0)

  // LIVE arm (amount <= 100, the Deny Decision, never published): the
  // run's stamp names it honestly as an unpinned draft resolution.
  await runBranch(page, panel, '50')
  await dblClickReachedTerminal(page, panel)
  await expect(overlay).toBeVisible()
  // The reader's view choice sticks for the session (goal 0326), so
  // this pane is still on Raw from the arm above.
  const liveOutput = overlay.getByTestId('step-detail-output-payload')
  await expect(liveOutput).toHaveAttribute('data-view', 'raw')
  await expect(liveOutput.getByTestId('step-detail-output-payload-raw')).toContainText('"resolvedVersion":"live@draft"')
  await page.keyboard.press('Escape')
  await expect(overlay).toHaveCount(0)

  // Restore the shared seeded fixture (testing.md's within-worker
  // cleanup discipline) so later tests in this file/worker see the
  // Approve Decision exactly as shipped.
  await openDecisionsTab(page)
  const approveRowAgain = decisionRow(page, 'Approve (example)')
  await clickRowAction(page, approveRowAgain, /Reset to shipped example/)
})

test('Branch to a decision: the approve path terminalizes with a typed outcome, and the terminal card has no source handle', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  const seed = 'Example: Branch to a decision'
  const row = workflowRow(page, seed)
  await expect(row).toBeVisible()
  await row.click()
  await expect(activePanel(page).locator('.react-flow__node').first()).toBeVisible()

  await activePanel(page).getByTestId('canvas-run').click()

  // The workflow declares an 'amount' Attribute -- Run opens the
  // test-input dialog (docs/adr/0008). 150 > 100 drives the approve arm.
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Amount').fill('150')
  await dialog.getByRole('button', { name: 'Run' }).click()

  const bar = activePanel(page).getByTestId('run-state-dock')
  await expect(bar).toContainText('SUCCESS', { timeout: 15_000 })

  // The reached terminal (Approve) card shows done, and -- the actual
  // terminal-shape assertion -- renders no source handle at all.
  const approveCard = activePanel(page).locator('.react-flow__node').filter({ hasText: 'Decision' }).filter({ hasText: 'DONE' }).first()
  await expect(approveCard).toBeVisible({ timeout: 10_000 })
  await expect(approveCard.locator('.react-flow__handle.source')).toHaveCount(0)
  await expect(approveCard.locator('.react-flow__handle.target')).toHaveCount(1)
})

test('Decision with review: a manual-review outcome parks in the Review queue; deny fails it closed', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  const seed = 'Example: Decision with review'
  const row = workflowRow(page, seed)
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Run' }).click()

  await page.getByRole('link', { name: 'Review' }).click()
  const item = page.getByTestId('review-item').filter({ hasText: seed }).first()
  await expect(item).toBeVisible({ timeout: 10_000 })
  await expect(item).toContainText('Manual review (example)')

  await item.getByTestId('review-deny').click()
  await expect(page.getByTestId('review-item').filter({ hasText: seed })).toHaveCount(0, { timeout: 10_000 })
})

// docs/SPEC.md §3.8's UI-mechanisms pass: TreeView's own indent-guide
// rail (`.prc-TreeView-TreeViewItemLevelLine-*`, inspected directly
// against the installed @primer/react's compiled CSS) is suppressed
// inside the "Add steps" palette specifically -- hovering anywhere in
// the tree otherwise lights up every group's rail at once, noise in a
// drag-source list.
test('Palette: the TreeView indent-guide rail is suppressed (display: none)', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByTestId('toggle-palette').click()

  const rail = activePanel(page).locator('[class*="TreeViewItemLevelLine"]').first()
  if (await rail.count() === 0) {
    // No nested item happens to render a level-line element in this
    // build's DOM shape -- nothing to assert against, not a failure.
    test.skip()
  }
  await expect(rail).toHaveCSS('display', 'none')

  await activePanel(page).getByRole('button', { name: 'Back to workflows' }).click()
})
