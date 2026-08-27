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

test('built-in labels are verb-first with no prefix, and pass through the palette unshortened', async ({ page }) => {
  await openPaletteOnNewWorkflow(page)
  const panel = activePanel(page)

  // Goal 0113: built-in NodeType labels dropped the "<Group>: " colon
  // prefix -- shortLabel is a no-op for them, so the palette item's own
  // text is the full label, unchanged from what a canvas card shows.
  const classifyItem = panel.locator('[data-node-type-id="process-ai-classify"]')
  await expect(classifyItem).toHaveText('Classify with AI')

  const readFileItem = panel.locator('[data-node-type-id="capture-file"]')
  await expect(readFileItem).toHaveText('Read file')

  const childItem = panel.locator('[data-node-type-id="child-workflow"]')
  await expect(childItem).toContainText('Run another workflow')
})

test('canvas node cards keep their full, self-contained label after being dropped from the palette', async ({ page }) => {
  await openPaletteOnNewWorkflow(page)
  await dragPaletteItemToCanvas(page, 'process-ai-classify')

  await expect(activePanel(page).locator('.react-flow__node').filter({ hasText: 'Classify with AI' })).toBeVisible()
})

test('palette search matches the step label, case-insensitively', async ({ page }) => {
  await openPaletteOnNewWorkflow(page)
  const panel = activePanel(page)
  const search = panel.getByTestId('palette-search')

  // "classify" matches only the one step whose label contains it.
  await search.fill('classify')
  await expect(panel.locator('[data-node-type-id="process-ai-classify"]')).toBeVisible()
  await expect(panel.getByTestId('palette-item')).toHaveCount(1)

  // "AI" (no colon) matches every step whose label mentions it --
  // "Classify with AI", "Generate with AI", "Extract fields with AI".
  await search.fill('AI')
  await expect(panel.locator('[data-node-type-id="process-ai-classify"]')).toBeVisible()
  await expect(panel.locator('[data-node-type-id="process-ai-completion"]')).toBeVisible()
  await expect(panel.locator('[data-node-type-id="process-ai-extract-structured"]')).toBeVisible()

  // A query matching nothing shows the empty state, not a silently
  // blank tree.
  await search.fill('zzz-no-such-step')
  await expect(panel.getByTestId('palette-item')).toHaveCount(0)
  await expect(panel.getByTestId('palette-no-matches')).toBeVisible()

  // Clearing the query restores the full palette (46
  // RegisterNodeType call sites, latest process-shell-command
  // (goal 0240 S1), + the seeded "Check httpbin" declared step type).
  await search.fill('')
  await expect(panel.getByTestId('palette-item')).toHaveCount(47)
})

// Goal 0113 slice 1: typing an intent-shaped query (not a step name)
// surfaces matching seeded workflows as a distinct "Examples" section
// below the step tree, so a user asking "how do I do X" finds a
// working example instead of hand-building from scratch.
test('palette search surfaces a matching seeded workflow under Examples, and opens it on click', async ({ page }) => {
  await openPaletteOnNewWorkflow(page)
  const panel = activePanel(page)
  const search = panel.getByTestId('palette-search')

  await search.fill('markdown')
  const exampleRow = panel.getByTestId('palette-example').filter({ hasText: 'Clipboard → Markdown' })
  await expect(exampleRow).toBeVisible()

  await exampleRow.click()
  await expect(activePanel(page).getByLabel('Label')).toHaveValue('Clipboard → Markdown')
})

// Goal 0113 slice 1: the "Show advanced steps" checkbox states its own
// count, and every advanced item carries a visible "Advanced" badge --
// honesty about which steps need code/JSON/external docs, not a silent
// split the user has to discover by trial.
test('the advanced toggle states its count, and the badge count matches while checked', async ({ page }) => {
  await openPaletteOnNewWorkflow(page)
  const panel = activePanel(page)

  const checkboxLabel = await panel.getByText(/^Show advanced steps \(\d+\)$/).textContent()
  const badgeCountWhileChecked = await panel.getByTestId('palette-advanced-badge').count()
  expect(checkboxLabel).toBe(`Show advanced steps (${badgeCountWhileChecked})`)
  expect(badgeCountWhileChecked).toBeGreaterThan(0)

  await panel.getByTestId('palette-show-advanced').uncheck()
  await expect(panel.getByTestId('palette-advanced-badge')).toHaveCount(0)
  const itemCountUnchecked = await panel.getByTestId('palette-item').count()
  expect(itemCountUnchecked).toBeLessThan(46)

  // Restore the default -- within-file cleanup discipline (testing.md):
  // this worker's browser context (and its localStorage) is shared with
  // every other test in this file.
  await panel.getByTestId('palette-show-advanced').check()
  await expect(panel.getByTestId('palette-item')).toHaveCount(47)
})

// Progressive-disclosure "Show advanced steps" toggle (goal 0047): the
// palette defaults to showing every step (changing the default palette
// contents would surprise existing users), a persisted per-browser
// choice hides ComplexityAdvanced steps for a simpler scan.
test('the palette shows every step by default, "Show advanced steps" checked', async ({ page }) => {
  await openPaletteOnNewWorkflow(page)
  const panel = activePanel(page)
  await expect(panel.getByTestId('palette-show-advanced')).toBeChecked()
  await expect(panel.getByTestId('palette-item')).toHaveCount(47)
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
    // goal 0070: fieldBindings is the same hand-authored JSON shape.
    'apply-list-row',
    // goal 0099: consumes a JSON items array from an attribute.
    'apply-atlas-from-reply',
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
