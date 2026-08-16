import { test, expect } from './fixtures/server'
import { activePanel, dragPaletteItemToCanvas } from './fixtures/canvas'

// Design wave 3 (goal 0001, audit §5): the palette's regrouping into 9
// frontend display groups (composition/paletteGroups.ts) instead of
// the 6 domain Kinds, plus the new search box. Real Go bindings over
// HTTP (Wails3 server mode) -- NodeTypes() is the real backend
// registry, not a fixture list, so a future node type landing without
// a matching NODE_TYPE_GROUP entry would show up here as a stray
// fallback-mapped item, not silently pass.

async function openPaletteOnNewWorkflow(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByTestId('toggle-palette').click()
}

test('the palette renders 9 groups with the expected membership', async ({ page }) => {
  await openPaletteOnNewWorkflow(page)
  const panel = activePanel(page)

  const groups = panel.getByTestId('palette-group')
  await expect(groups).toHaveCount(9)

  const expectedGroupIDs = ['triggers', 'capture', 'transform', 'ai', 'data', 'actions', 'flow', 'guardrails', 'apply']
  for (const id of expectedGroupIDs) {
    await expect(panel.locator(`[data-testid="palette-group"][data-group-id="${id}"]`)).toBeVisible()
  }

  // Spot-check membership by node-type-id (stable, not display text --
  // see paletteGroups.ts's NODE_TYPE_GROUP for the full map).
  const membership: Record<string, string[]> = {
    ai: ['process-ai-classify', 'process-ai-completion', 'process-ai-extract-structured'],
    data: ['list-lookup', 'list-search'],
    guardrails: ['human-review', 'ruleset', 'decision-outcome'],
    flow: ['child-workflow', 'decision-route'],
  }
  for (const [groupID, nodeTypeIDs] of Object.entries(membership)) {
    const group = panel.locator(`[data-testid="palette-group"][data-group-id="${groupID}"]`)
    for (const ntID of nodeTypeIDs) {
      await expect(group.locator(`[data-node-type-id="${ntID}"]`)).toBeVisible()
    }
  }
})

test('palette labels are shortened under their group (no repeated prefix)', async ({ page }) => {
  await openPaletteOnNewWorkflow(page)
  const panel = activePanel(page)

  // "AI: Classify" -> "Classify" under the AI group; the palette item's
  // own text is the short form, never the full "<Group>: " prefix.
  const classifyItem = panel.locator('[data-node-type-id="process-ai-classify"]')
  await expect(classifyItem).toHaveText('Classify')

  const httpItem = panel.locator('[data-node-type-id="integration-http"]')
  await expect(httpItem).toHaveText('HTTP call')

  // Already-clean labels (no colon prefix) pass through unchanged.
  const childItem = panel.locator('[data-node-type-id="child-workflow"]')
  await expect(childItem).toHaveText('Run another workflow')
})

test('canvas node cards keep their full, self-contained label after being dropped from the palette', async ({ page }) => {
  await openPaletteOnNewWorkflow(page)
  await dragPaletteItemToCanvas(page, 'process-ai-classify')

  // A card on canvas has no surrounding group context, so it keeps the
  // full "AI: Classify" label -- only the palette display shortens.
  await expect(activePanel(page).locator('.react-flow__node').filter({ hasText: 'AI: Classify' })).toBeVisible()
})

test('palette search matches both the shortened display name and the full underlying label', async ({ page }) => {
  await openPaletteOnNewWorkflow(page)
  const panel = activePanel(page)
  const search = panel.getByTestId('palette-search')

  // "classify" matches the SHORT displayed text ("Classify").
  await search.fill('classify')
  await expect(panel.locator('[data-node-type-id="process-ai-classify"]')).toBeVisible()
  await expect(panel.getByTestId('palette-item')).toHaveCount(1)

  // "AI:" only appears in the FULL underlying label ("AI: Classify"),
  // never in the shortened display text ("Classify") -- still matches.
  await search.fill('AI:')
  await expect(panel.locator('[data-node-type-id="process-ai-classify"]')).toBeVisible()
  await expect(panel.locator('[data-node-type-id="process-ai-completion"]')).toBeVisible()
  await expect(panel.locator('[data-node-type-id="process-ai-extract-structured"]')).toBeVisible()

  // A query matching nothing shows the empty state, not a silently
  // blank tree.
  await search.fill('zzz-no-such-step')
  await expect(panel.getByTestId('palette-item')).toHaveCount(0)
  await expect(panel.getByTestId('palette-no-matches')).toBeVisible()

  // Clearing the query restores the full 38-item palette (37
  // RegisterNodeType call sites + the seeded "Check httpbin" declared
  // step type, goal 0054 slice A).
  await search.fill('')
  await expect(panel.getByTestId('palette-item')).toHaveCount(38)
})

// Progressive-disclosure "Show advanced steps" toggle (goal 0047): the
// palette defaults to showing every step (changing the default palette
// contents would surprise existing users), a persisted per-browser
// choice hides ComplexityAdvanced steps for a simpler scan.
test('the palette shows every step by default, "Show advanced steps" checked', async ({ page }) => {
  await openPaletteOnNewWorkflow(page)
  const panel = activePanel(page)
  await expect(panel.getByTestId('palette-show-advanced')).toBeChecked()
  await expect(panel.getByTestId('palette-item')).toHaveCount(38)
})

test('unchecking "Show advanced steps" hides advanced steps, keeps basic ones, and persists across a reload', async ({ page }) => {
  await openPaletteOnNewWorkflow(page)
  let panel = activePanel(page)

  await expect(panel.locator('[data-node-type-id="integration-http"]')).toBeVisible()
  await expect(panel.locator('[data-node-type-id="human-review"]')).toBeVisible()

  await panel.getByTestId('palette-show-advanced').uncheck()

  // Every goal-0047 "advanced" step (needs the target's own
  // documentation, or hand-written code/JSON/expressions) disappears...
  const advancedIDs = [
    'integration-http', 'mcp-tool-call', 'code-execution',
    'ruleset', 'child-workflow', 'list-search', 'process-ai-extract-structured',
    // goal 0066: matchParams/fieldBindings are hand-authored JSON, the
    // same reasoning list-search's own matchParams carries.
    'process-atlas-card-find', 'apply-atlas-card-create', 'apply-atlas-card-update',
  ]
  for (const id of advancedIDs) {
    await expect(panel.locator(`[data-node-type-id="${id}"]`)).toHaveCount(0)
  }
  // ...while a "basic" plain-value step stays visible, including a
  // declared step type (always ComplexityBasic by construction,
  // composition/declaredsteptype.go's resolveDeclaredEntry).
  await expect(panel.locator('[data-node-type-id="human-review"]')).toBeVisible()
  await expect(panel.locator('[data-node-type-id="decision-route"]')).toBeVisible()
  await expect(panel.locator('[data-node-type-id="example-check-httpbin-step"]')).toBeVisible()
  // goal 0066: apply-atlas-card-link's fields are all plain values, no
  // JSON authoring -- stays basic.
  await expect(panel.locator('[data-node-type-id="apply-atlas-card-link"]')).toBeVisible()
  await expect(panel.locator('[data-node-type-id="trigger-atlas-card"]')).toBeVisible()

  // Persists across a reload -- a fresh page load re-reads the same
  // localStorage-backed choice, not an in-memory-only default.
  await page.reload()
  await activePanel(page).getByTestId('toggle-palette').click()
  panel = activePanel(page)
  await expect(panel.getByTestId('palette-show-advanced')).not.toBeChecked()
  await expect(panel.locator('[data-node-type-id="integration-http"]')).toHaveCount(0)

  // Restore the default -- within-file cleanup discipline (testing.md):
  // this worker's browser context (and its localStorage) is shared with
  // every other test in this file.
  await panel.getByTestId('palette-show-advanced').check()
  await expect(panel.locator('[data-node-type-id="integration-http"]')).toBeVisible()
})
