import { test, expect } from '@playwright/test'

// Exercises the shared rows/table view switch (ViewModeToggle + Primer
// DataTable, docs/goals/0007-resource-inventory-redesign.md) on two
// inventory pages -- the toggle renders a real sortable table of the
// same rows the row view shows, and the choice persists per page.
// Dense InventoryList rows are the DEFAULT now (cards are retired
// outright); this file also covers the goal's own acceptance bar --
// rows-by-default on a fresh profile, and each surface rendering a
// distinct per-entity leading icon (the executable form of
// "recognition, not confirmation").

test('Workflows list switches to a table view and back', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  await page.getByRole('button', { name: 'Table view' }).click()
  const table = page.getByRole('table', { name: 'Saved workflows' })
  await expect(table).toBeVisible()
  // The two seeded built-ins render as table rows with their actions.
  await expect(table.getByRole('row').filter({ hasText: 'Clipboard → Markdown' })).toBeVisible()
  await expect(table.getByRole('button', { name: 'Run Clipboard → Markdown' })).toBeVisible()

  await page.getByRole('button', { name: 'Row view' }).click()
  await expect(page.locator('[data-testid="inventory-row"][data-entity="workflow"]').first()).toBeVisible()
  await expect(table).not.toBeVisible()
})

test('Integrations list switches to a table view showing Method and Auth columns', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()

  await page.getByRole('button', { name: 'Table view' }).click()
  const table = page.getByRole('table', { name: 'Integrations' })
  await expect(table).toBeVisible()
  await expect(table.getByRole('columnheader', { name: 'Method' })).toBeVisible()
  await expect(table.getByRole('columnheader', { name: 'Auth' })).toBeVisible()
  await expect(table.getByRole('row').filter({ hasText: 'Example: Bearer token' })).toBeVisible()

  // Restore row view so other specs (which assert on inventory rows)
  // see the default regardless of run order -- the mode persists in
  // localStorage deliberately.
  await page.getByRole('button', { name: 'Row view' }).click()
  await expect(page.locator('[data-testid="inventory-row"][data-entity="request"]').first()).toBeVisible()
})

test('Rows are the default view on a fresh profile, no localStorage needed', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  // No explicit toggle click at all -- useViewMode's own default
  // (viewMode.ts) is 'rows', not 'table', on a storage key that has
  // never been written.
  await expect(page.getByRole('button', { name: 'Row view', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-testid="inventory-row"][data-entity="workflow"]').first()).toBeVisible()
  await expect(page.getByRole('table', { name: 'Saved workflows' })).not.toBeVisible()
})

test('A legacy stored "cards" viewMode value reads back as rows, not an error', async ({ page }) => {
  // Pre-goal-0007 installs persisted 'cards' -- viewMode.ts's own
  // migration is just "anything that isn't the literal 'table' string
  // reads as rows," so this proves that reading a real old value
  // doesn't throw or silently fall back to the table view instead.
  await page.addInitScript(() => {
    window.localStorage.setItem('mill-workflows-view-mode', 'cards')
  })
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  await expect(page.getByRole('button', { name: 'Row view', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-testid="inventory-row"][data-entity="workflow"]').first()).toBeVisible()
})

test('Each inventory surface renders its own distinct entity icon -- the recognition cue', async ({ page }) => {
  // The goal's own acceptance bar, in executable form: "owner opens
  // Workflows and Integrations back-to-back and never mistakes one for
  // the other" -- checked here as two pages rendering a genuinely
  // different data-entity value (and therefore a different icon/color
  // pairing, entityIcons.ts) on their leading visual, not shared
  // silhouette-and-text like the old cards did.
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  const workflowRow = page.locator('[data-testid="inventory-row"][data-entity="workflow"]').first()
  await expect(workflowRow).toBeVisible()

  await page.getByRole('link', { name: 'Configure' }).click()
  const requestRow = page.locator('[data-testid="inventory-row"][data-entity="request"]').first()
  await expect(requestRow).toBeVisible()

  await page.getByRole('tab', { name: 'Lists' }).click()
  await page.getByTestId('new-list').click()
  await page.getByLabel('Label').fill('E2E icon check list')
  await page.getByRole('button', { name: 'Save list' }).click()
  const listRow = page.locator('[data-testid="inventory-row"][data-entity="list"]').filter({ has: page.getByText('E2E icon check list', { exact: true }) })
  await expect(listRow).toBeVisible()

  // Three distinct entity values proves three distinct identities --
  // not asserting on the icon SVG itself (an implementation detail),
  // asserting on the data-entity contract InventoryList.tsx renders it
  // from, which the icon is deterministically keyed off (entityIcons.ts).
  // Each was already checked live, in place, as its own page/tab was
  // active (workflowRow/requestRow/listRow above) -- not re-asserted
  // here as a combined recheck, since Workflows and Configure are
  // mutually exclusive top-level views (WorkTabShell only ever mounts
  // the current section's page) and by this point in the test
  // Workflows has genuinely unmounted, not merely hidden.

  await listRow.getByTestId('inventory-row-menu').click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await expect(listRow).toHaveCount(0)
})

test('The inventory search box filters rows by label', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  const search = page.getByTestId('inventory-search')
  await expect(page.locator('[data-testid="inventory-row"][data-entity="workflow"]').filter({ hasText: 'Clipboard → Markdown' })).toBeVisible()
  // "Markdown", not "Clipboard" -- "Load sample HTML"'s own description
  // ("puts real HTML on the clipboard") would also match a "clipboard"
  // substring, which isn't what this is testing.
  await search.fill('Markdown')
  await expect(page.locator('[data-testid="inventory-row"][data-entity="workflow"]')).toHaveCount(1)
  await expect(page.getByText('Load sample HTML')).toHaveCount(0)

  await search.fill('this matches nothing at all')
  await expect(page.locator('[data-testid="inventory-row"][data-entity="workflow"]')).toHaveCount(0)
  await expect(page.getByText(/No matches for/)).toBeVisible()

  await search.fill('')
  await expect(page.locator('[data-testid="inventory-row"][data-entity="workflow"]').first()).toBeVisible()
})

// MCP Servers has no seeded built-ins (internal/domain/mcpserver has no
// BuiltIn() -- unlike Decisions/Workflows/Requests, checked directly
// before relying on it), and every other spec that creates one deletes
// it (.claude/rules/testing.md) -- so this surface is the one that can
// genuinely reach zero items. Drains whatever's there first (defensive
// against a prior run leaving something behind) rather than assuming
// it's already empty, so this test is self-contained regardless of
// suite run order against the shared e2e settings file.
test('A genuinely empty inventory renders Blankslate, not a bare table/list', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'MCP Servers' }).click()

  const rows = page.locator('[data-testid="inventory-row"][data-entity="mcpserver"]')
  while (true) {
    const count = await rows.count()
    if (count === 0) break
    await rows.first().getByTestId('inventory-row-menu').click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await expect(rows).toHaveCount(count - 1)
  }

  // Scoped to the active tabpanel -- Configure's own four sub-tabs all
  // stay mounted (a `hidden` attribute toggles, never unmounts), so an
  // unscoped getByTestId('inventory-search') also matches Requests'/
  // Lists'/Decisions' own non-empty search boxes sitting hidden
  // elsewhere in the DOM (getByTestId doesn't filter by visibility).
  const mcpPanel = page.locator('[role="tabpanel"]:not([hidden])').last()
  await expect(mcpPanel.getByRole('heading', { name: 'No MCP servers yet' })).toBeVisible()
  await expect(mcpPanel.getByText(/A reusable stdio connection/)).toBeVisible()
  await expect(mcpPanel.getByTestId('inventory-search')).toHaveCount(0)

  // Restore: create one back so this test doesn't permanently strip a
  // fixture another spec (mcp-tool-editor.spec.ts) creates-and-deletes
  // its own anyway -- harmless either way, but leaves nothing net-new.
  await page.getByTestId('new-mcpserver').click()
  await page.getByLabel('Label').fill('E2E blankslate restore')
  await page.getByLabel('Command').fill('true')
  await page.getByRole('button', { name: 'Save MCP server' }).click()
  const restored = page.locator('[data-testid="inventory-row"][data-entity="mcpserver"]').filter({ has: page.getByText('E2E blankslate restore', { exact: true }) })
  await expect(restored).toBeVisible()
  await restored.getByTestId('inventory-row-menu').click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await expect(restored).toHaveCount(0)
})

test('Inventory rows stay single-line: long labels truncate, never wrap into tall rows', async ({ page }) => {
  // Owner-caught regression shape: long workflow labels folded into 3-4
  // stacked lines with badges tumbling underneath. The seeded examples
  // include deliberately long labels ("Example: Approval-gated HTTP
  // call"), so uniform row height against them IS the proof.
  await page.goto('/')
  const rows = page.locator('[data-testid="inventory-row"][data-entity="workflow"]')
  await expect(rows.first()).toBeVisible()
  const heights = await rows.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))
  for (const h of heights) expect(h).toBeLessThan(60)
})
