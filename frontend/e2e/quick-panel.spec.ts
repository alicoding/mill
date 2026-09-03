import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { test, expect } from './fixtures/server'
import { clickRowAction } from './inventoryRow'
import {
  connectMCPClient, enableMCPWritesWithApprovalRequired, exportWorkflowViaMCP,
  findWorkflowIdByLabel, restoreMCPWriteDefaults, stripExportedID,
} from './mcpTestClient'
import { assignDebugWorkflowHotkey } from './hotkeyDebugKnob'
import { workflowRow, activePanel, dragBetweenHandles, dragPaletteItemToCanvas } from './fixtures/canvas'
import { waitForViewportStable } from './fixtures/animation'

// Exercises the Quick Panel's frontend (docs/adr/0033-quick-panel-
// second-window.md, app/QuickPanel.tsx) at its hash route
// (/#/quickpanel) over real Go bindings (Wails3 server mode). The
// route itself is fully e2e-able headlessly -- confirmed directly
// against the beta.4 SDK source: server-mode "windows" are
// BrowserWindow connections keyed by whatever page a browser tab
// loads, and this second window's URL is a hash fragment of the SAME
// served index.html main.tsx already renders, so page.goto('/#/quickpanel')
// exercises the real production code path (main.tsx's hash branch),
// not a stand-in. What's NOT headlessly verifiable is the WINDOW-LEVEL
// behavior around it (floating window level, hide-on-blur/Escape via
// the native HideOnFocusLost/HideOnEscape options, the focus-yield
// mitigation, and the real global summon hotkey delivery) -- those are
// registered in the manual-only registry (.claude/skills/run-mill/SKILL.md)
// per .claude/rules/testing.md's own "manual-only registry... never
// silently absent" requirement.

// Same helpers as command-palette.spec.ts's own local copies (see that
// file's comments for the full reasoning on each) -- duplicated rather
// than shared, matching this suite's existing per-spec-file convention.
async function fitAndSpaceOut(page: import('@playwright/test').Page) {
  const panel = activePanel(page)
  await panel.getByRole('button', { name: 'Fit View' }).click()
  await waitForViewportStable(panel)
  await panel.getByRole('button', { name: 'Zoom Out' }).click()
  await waitForViewportStable(panel)
}

// Kept local, not the fixtures/canvas.ts connectNodes -- same
// divergence as command-palette.spec.ts's own copy (fitAndSpaceOut's
// Fit View already ran; the shared version's baked-in one would undo
// the Zoom Out clearance).
async function connectNodes(page: import('@playwright/test').Page, sourceLabel: string, targetLabel: string) {
  const panel = activePanel(page)
  const sourceHandle = panel.locator('.react-flow__node').filter({ hasText: sourceLabel }).locator('.react-flow__handle.source')
  const targetHandle = panel.locator('.react-flow__node').filter({ hasText: targetLabel }).locator('.react-flow__handle.target')
  // steps: 0 -- this copy's own divergence from fixtures/canvas.ts's
  // connectNodes (see header comment): a direct hover-down-hover-up
  // jump, no intermediate path.
  await dragBetweenHandles(page, sourceHandle, targetHandle, 0, true)
}

// A deliberately clipboard-free workflow (trigger-manual -> a plain
// process-inject-text step, per .claude/rules/testing.md's own
// guidance to prefer a workflow that doesn't touch the clipboard over
// taking the cross-process clipboard lock).
async function createSimpleWorkflow(page: import('@playwright/test').Page, label: string) {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await activePanel(page).getByTestId('toggle-palette').click()
  await dragPaletteItemToCanvas(page, 'process-inject-text')
  await expect(activePanel(page).locator('.react-flow__node')).toHaveCount(2)
  await fitAndSpaceOut(page)
  await connectNodes(page, 'Manual run', 'Add text')
  await expect(activePanel(page).locator('.react-flow__edge')).toHaveCount(1)
  await activePanel(page).getByLabel('Label').fill(label)
  await activePanel(page).getByTestId('save-workflow').click()
  await expect(workflowRow(page, label)).toBeVisible()
}

// A single trigger-hotkey root node, no second step -- matches
// trigger-row.spec.ts's own hotkey-row test recipe and command-palette.
// spec.ts's own copy of this helper (a bare Trigger node is a valid,
// saveable graph; nothing here needs to actually run).
async function createHotkeyTriggerWorkflow(page: import('@playwright/test').Page, label: string) {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByTestId('new-workflow').click()
  await activePanel(page).locator('.react-flow__node').first().click()
  await activePanel(page).getByTestId('change-node-type').selectOption('trigger-hotkey')
  await activePanel(page).getByLabel('Label').fill(label)
  await activePanel(page).getByTestId('save-workflow').click()
  await expect(workflowRow(page, label)).toBeVisible()
}

async function deleteWorkflow(page: import('@playwright/test').Page, label: string) {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  const row = workflowRow(page, label)
  await clickRowAction(page, row, 'Delete')
  await expect(row).toHaveCount(0)
}

test('the Quick Panel route renders standalone with an autofocused search input', async ({ page }) => {
  await page.goto('/#/quickpanel')

  const search = page.getByRole('combobox', { name: 'Quick Panel search' })
  await expect(search).toBeVisible()
  await expect(search).toBeFocused()

  // No sidebar/PageLayout chrome -- this is the dedicated minimal
  // shell (QuickPanelApp), not <App/>'s tree.
  await expect(page.getByRole('link', { name: 'Workflows' })).toHaveCount(0)

  await expect(page.getByRole('option', { name: 'Open Mill' })).toBeVisible()
  await expect(page.getByRole('option', { name: /Open Settings/ })).toBeVisible()
})

test('a seeded workflow is listed and Enter runs it, showing the outcome in the footer and offering the row actions', async ({ page }) => {
  const label = 'ZzE2eQuickPanelRunTarget'
  await createSimpleWorkflow(page, label)

  // A hash-only change from the already-loaded '/' is a same-document
  // navigation (no reload), which would leave <App/> mounted instead of
  // re-evaluating main.tsx's hash branch -- forcing a genuine
  // cross-document navigation first (as every real second-window load
  // is) so this exercises the real branch, not a stale DOM.
  await page.goto('about:blank')
  await page.goto('/#/quickpanel')
  const search = page.getByRole('combobox', { name: 'Quick Panel search' })
  await expect(search).toBeFocused()
  await search.fill(label)

  const runOption = page.getByRole('option', { name: label })
  await expect(runOption).toBeVisible()

  // The footer names the active row's actions before anything runs.
  await expect(page.getByTestId('quick-panel-run-hint')).toHaveText('↩')
  await page.keyboard.press('Enter')
  // Outcome stays put (goal 0294): no auto-dismiss, the footer says
  // whether it worked and how long it took.
  await expect(page.getByTestId('quick-panel-status')).toContainText(`Done — "${label}" in`)
  await expect(page.getByTestId('quick-panel-status')).toContainText('s')

  // ⌘K opens the row's actions, each with its own shortcut.
  await page.keyboard.press('Meta+k')
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  await expect(page.getByTestId('quick-panel-action-run')).toContainText('Run')
  await expect(page.getByTestId('quick-panel-action-run-watch')).toContainText('Run and watch')
  await expect(page.getByTestId('quick-panel-action-run-watch-shortcut')).toHaveText('⌘⇧↩')
  await expect(page.getByTestId('quick-panel-action-open')).toContainText('Open workflow')
  await expect(page.getByTestId('quick-panel-action-open-shortcut')).toHaveText('⌘↩')
  await expect(page.getByTestId('quick-panel-action-pin')).toContainText('Pin')
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  // Typing resumes in the search, not on the menu's anchor button.
  await expect(search).toBeFocused()

  await deleteWorkflow(page, label)
})

// docs/goals/0015-summon-quick-invoke.md's remainder, item 3: Configure
// entities as searchable/jumpable rows. Reuses the seeded "Example:
// Country codes" List (internal/domain/list/builtin.go) rather than
// creating a throwaway one, same reasoning configure-lists.spec.ts's
// own header comment gives -- nothing List-shaped to clean up.
test('typing a few chars and picking a Configure entity jumps the main window to its tab', async ({ page }) => {
  // Two real pages against the SAME worker server -- the main window
  // and the Quick Panel are genuinely separate Wails windows in
  // production (ADR-0033); realtime-cross-surface.spec.ts's own "two
  // open surfaces" pattern is the real cross-window shape to test
  // against, not one page simulating both. The Quick Panel's jump row
  // asks the MAIN window to navigate (SettingsService.OpenMainWindow,
  // app/useMillNavigate.ts) -- it never renders Configure itself.
  const mainPage = await page.context().newPage()
  try {
    await mainPage.goto('/')

    await page.goto('/#/quickpanel')
    const search = page.getByRole('combobox', { name: 'Quick Panel search' })
    await expect(search).toBeFocused()
    await search.fill('country')

    const option = page.getByRole('option', { name: 'Example: Country codes' })
    await expect(option).toBeVisible()
    await option.click()

    // ConfigureView's Lists tab panel becomes visible on the MAIN
    // window -- every TabPanel stays mounted (ConfigureView.tsx's own
    // doc comment), so `toBeVisible()` (not just present in the DOM) is
    // the real "did the jump land on the right tab" signal.
    await expect(mainPage.getByTestId('configure-lists')).toBeVisible({ timeout: 10_000 })
    await expect(
      mainPage.locator('[data-testid="inventory-row"][data-entity="list"]', {
        has: mainPage.getByText('Example: Country codes', { exact: true }),
      }),
    ).toBeVisible()
  } finally {
    await mainPage.close()
  }
})

// Quick-access parity sweep (goal 0071 G5): the same jump-row pattern
// extended to Decisions and AI Providers -- two of the four Configure
// entity kinds added alongside the original three (Integration/Lists/
// MCP Servers). Reuses seeded builtins (internal/domain/decision/
// builtin.go's "Approve (example)", internal/domain/aiprovider/
// builtin.go's "Local Ollama") rather than creating throwaway entities.
test('Quick Panel jump rows exist for Decisions and AI Providers (goal 0071 parity sweep)', async ({ page }) => {
  const mainPage = await page.context().newPage()
  try {
    await mainPage.goto('/')

    await page.goto('/#/quickpanel')
    const search = page.getByRole('combobox', { name: 'Quick Panel search' })
    await expect(search).toBeFocused()

    await search.fill('Approve')
    await expect(page.getByRole('option', { name: 'Approve (example)' })).toBeVisible()
    await page.getByRole('option', { name: 'Approve (example)' }).click()
    await expect(mainPage.getByTestId('configure-decisions')).toBeVisible({ timeout: 10_000 })

    await search.fill('')
    await search.fill('Ollama')
    await expect(page.getByRole('option', { name: /Local Ollama/ })).toBeVisible()
    await page.getByRole('option', { name: /Local Ollama/ }).click()
    await expect(mainPage.getByTestId('configure-aiproviders')).toBeVisible({ timeout: 10_000 })
  } finally {
    await mainPage.close()
  }
})

// G6: a per-Configure-tab create command drives the tab's own in-page
// create flow, not just a jump to the tab. "New list" proves the
// signal-consumption pattern shared/configureCreateRequest -> each
// tab's startCreate() (configure/ConfigureLists.tsx and five siblings
// share the exact same wiring).
test('Running "New list" from the palette opens Configure -> Lists with the create form already open', async ({ page }) => {
  await page.goto('/')
  // The shell paints after a short async boot (plugins load first --
  // docs/goals/0249); a keypress before anything is visible is not a
  // user primitive, so the first press waits for the painted nav.
  await expect(page.getByTestId('sidebar-nav')).toBeVisible()
  await page.keyboard.press('Meta+k')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(palette).toBeVisible()
  await palette.getByRole('combobox').fill('New list')
  await expect(page.getByRole('option', { name: 'New list' })).toBeVisible()
  await page.getByRole('option', { name: 'New list' }).click()

  await expect(page.getByTestId('configure-lists')).toBeVisible()
  await expect(page.getByTestId('save-list')).toBeVisible()
})

// docs/goals/0015-summon-quick-invoke.md's remainder, item 1: frecency
// sort. workflowFrecency.test.ts already covers the pure ranking
// function in isolation; this proves the live wiring end to end
// (QuickPanel actually calls ExecutionService.HomeMetrics and reads its
// response's real field names -- a casing/wiring mistake here would
// pass the pure unit test but fail this one).
test('a workflow run from the panel a few times sorts above one that was never run', async ({ page }) => {
  const frequentLabel = 'ZzE2eFrecencyFrequent'
  const neverRunLabel = 'ZzE2eFrecencyNeverRun'
  // neverRunLabel created FIRST, frequentLabel second -- so the
  // fetch's own default (creation-order-ish) fallback would already
  // put neverRunLabel ahead absent any frecency reordering. Only the
  // frecency sort itself can flip that, making this a real proof
  // rather than a coincidental pass.
  await createSimpleWorkflow(page, neverRunLabel)
  await createSimpleWorkflow(page, frequentLabel)

  await page.goto('about:blank')
  await page.goto('/#/quickpanel')
  const search = page.getByRole('combobox', { name: 'Quick Panel search' })
  await expect(search).toBeFocused()

  // Run the "frequent" workflow twice via the panel's own Enter-to-run
  // path (ExecutionService.RunWorkflow, RunKindTest) -- the exact usage
  // HomeMetrics' MostUsed counts (executionservice_home.go's
  // mostUsedFor: every run regardless of Kind/Status).
  for (let i = 0; i < 2; i++) {
    await search.fill(frequentLabel)
    await expect(page.getByRole('option', { name: frequentLabel })).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('quick-panel-status')).toContainText(`Done — "${frequentLabel}"`)
    await search.fill('')
  }

  // DBOS run history becomes queryable shortly after RunWorkflow
  // returns, not necessarily synchronously with it -- retry the
  // fresh-mount reload + order check rather than a fixed sleep.
  await expect(async () => {
    await page.goto('about:blank')
    await page.goto('/#/quickpanel')
    await expect(page.getByRole('combobox', { name: 'Quick Panel search' })).toBeFocused()
    await page.getByRole('combobox', { name: 'Quick Panel search' }).fill('ZzE2eFrecency')
    const optionTexts = await page.getByRole('option').allTextContents()
    const frequentIndex = optionTexts.findIndex((t) => t.includes(frequentLabel))
    const neverRunIndex = optionTexts.findIndex((t) => t.includes(neverRunLabel))
    expect(frequentIndex).toBeGreaterThanOrEqual(0)
    expect(neverRunIndex).toBeGreaterThanOrEqual(0)
    expect(frequentIndex).toBeLessThan(neverRunIndex)
  }).toPass({ timeout: 15_000 })

  await deleteWorkflow(page, frequentLabel)
  await deleteWorkflow(page, neverRunLabel)
})

// docs/goals/0015-summon-quick-invoke.md's remainder, item 2:
// pending-review count. Judged e2e-feasible (not manual-only, per
// .claude/rules/testing.md's own decision criterion) -- the same real
// MCP write client + park-and-poll lifecycle mcp-write-approval.spec.ts
// already drives headlessly. This proves the LIVE subscription (the
// panel stays open, on the same page, across the park -- no reload
// between parking the write and reading the badge), not just the
// on-mount fetch every other assertion here already exercises
// incidentally.
test('a parked MCP write bumps the Quick Panel review badge live, no reload', async ({ page }, testInfo) => {
  await enableMCPWritesWithApprovalRequired(page)

  const sourceLabel = 'ZzE2eQuickPanelReviewSource'
  await createSimpleWorkflow(page, sourceLabel)

  await page.goto('about:blank')
  await page.goto('/#/quickpanel')
  const search = page.getByRole('combobox', { name: 'Quick Panel search' })
  await expect(search).toBeFocused()

  const client = await connectMCPClient(testInfo.parallelIndex)
  let importResultPromise: ReturnType<Client['callTool']>
  try {
    const sourceId = await findWorkflowIdByLabel(client, sourceLabel)
    const exported = await exportWorkflowViaMCP(client, sourceId)
    importResultPromise = client.callTool({ name: 'import_workflow', arguments: { json: stripExportedID(exported) } })

    const badge = page.getByTestId('quick-panel-review-count')
    await expect(badge).toHaveText('1', { timeout: 15_000 })

    // Resolve it via the main window's real Review queue -- same
    // approve path mcp-write-approval.spec.ts exercises end to end --
    // so the park doesn't leak into another test's own pending count.
    await page.goto('/')
    await page.getByRole('link', { name: 'Review' }).click()
    const item = page.getByTestId('review-mcp-write-item').first()
    await expect(item).toBeVisible({ timeout: 15_000 })
    await item.getByTestId('review-mcp-write-approve').click()
    await expect(page.getByTestId('review-mcp-write-item')).toHaveCount(0, { timeout: 10_000 })

    const result = await importResultPromise
    if (result.isError) {
      throw new Error(`import_workflow ultimately errored after approval: ${JSON.stringify(result.content)}`)
    }
  } finally {
    await client.close()
  }

  // Cleanup: both minted workflows (the source + the one approving the
  // import minted) and the settings toggle.
  await page.getByRole('link', { name: 'Workflows' }).click()
  let remaining = await workflowRow(page, sourceLabel).count()
  while (remaining > 0) {
    await clickRowAction(page, workflowRow(page, sourceLabel).first(), 'Delete')
    remaining -= 1
    await expect(workflowRow(page, sourceLabel)).toHaveCount(remaining)
  }
  await restoreMCPWriteDefaults(page)
})

// docs/goals/BACKLOG.md Standing #5 -- workflow pins/favorites.
// workflowFrecency.test.ts already covers the pure
// sortWorkflowsByPinnedAndFrecency function; this proves the live
// wiring end to end: pinning via the panel row's own toggle overrides
// frecency ranking, unpinning reverts to it, and the pin survives a
// reload (the localStorage-tier persistence the schema calls for).
test('pinning a workflow from the panel row sorts it above frecency, unpinning reverts, and the pin persists across reload', async ({ page }) => {
  const pinnedLabel = 'ZzE2ePinTargetPinned'
  const frequentLabel = 'ZzE2ePinTargetFrequent'
  // frequentLabel created FIRST, pinnedLabel second -- so absent any
  // pin, frequentLabel's own run count would already outrank
  // pinnedLabel (same "real proof, not a coincidental pass" discipline
  // as the frecency test above).
  await createSimpleWorkflow(page, frequentLabel)
  await createSimpleWorkflow(page, pinnedLabel)

  await page.goto('about:blank')
  await page.goto('/#/quickpanel')
  const search = page.getByRole('combobox', { name: 'Quick Panel search' })
  await expect(search).toBeFocused()

  // Build up frequentLabel's frecency via the panel's own Enter-to-run
  // path, same as the frecency test above.
  for (let i = 0; i < 2; i++) {
    await search.fill(frequentLabel)
    await expect(page.getByRole('option', { name: frequentLabel })).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('quick-panel-status')).toContainText(`Done — "${frequentLabel}"`)
    await search.fill('')
  }

  const orderedLabels = async () => {
    await search.fill('ZzE2ePinTarget')
    const texts = await page.getByRole('option').allTextContents()
    return texts
  }

  // Before pinning: DBOS run history becomes queryable shortly after
  // RunWorkflow returns, not necessarily synchronously -- retry the
  // fresh-mount reload + order check rather than a fixed sleep, same
  // as the frecency test.
  await expect(async () => {
    await page.goto('about:blank')
    await page.goto('/#/quickpanel')
    await expect(search).toBeFocused()
    const texts = await orderedLabels()
    const frequentIndex = texts.findIndex((t) => t.includes(frequentLabel))
    const pinnedIndex = texts.findIndex((t) => t.includes(pinnedLabel))
    expect(frequentIndex).toBeGreaterThanOrEqual(0)
    expect(pinnedIndex).toBeGreaterThanOrEqual(0)
    expect(frequentIndex).toBeLessThan(pinnedIndex)
  }).toPass({ timeout: 15_000 })

  // Pin the never-run workflow via its row's pin toggle -- it should
  // now sort ABOVE the frequently-run one despite having zero runs.
  await search.fill(pinnedLabel)
  await expect(page.getByRole('option', { name: pinnedLabel })).toBeVisible()
  await page.getByRole('button', { name: `Pin "${pinnedLabel}"` }).click()
  await expect(page.getByRole('button', { name: `Unpin "${pinnedLabel}"` })).toBeVisible()

  let texts = await orderedLabels()
  let frequentIndex = texts.findIndex((t) => t.includes(frequentLabel))
  let pinnedIndex = texts.findIndex((t) => t.includes(pinnedLabel))
  expect(pinnedIndex).toBeLessThan(frequentIndex)

  // Persists across reload: a fresh mount of the same window still
  // shows the pin above frecency, with no re-pinning gesture.
  await page.goto('about:blank')
  await page.goto('/#/quickpanel')
  await expect(page.getByRole('combobox', { name: 'Quick Panel search' })).toBeFocused()
  texts = await orderedLabels()
  frequentIndex = texts.findIndex((t) => t.includes(frequentLabel))
  pinnedIndex = texts.findIndex((t) => t.includes(pinnedLabel))
  expect(pinnedIndex).toBeLessThan(frequentIndex)
  await expect(page.getByRole('button', { name: `Unpin "${pinnedLabel}"` })).toBeVisible()

  // Unpinning reverts to frecency order.
  await page.getByRole('button', { name: `Unpin "${pinnedLabel}"` }).click()
  await expect(page.getByRole('button', { name: `Pin "${pinnedLabel}"` })).toBeVisible()
  texts = await orderedLabels()
  frequentIndex = texts.findIndex((t) => t.includes(frequentLabel))
  pinnedIndex = texts.findIndex((t) => t.includes(pinnedLabel))
  expect(frequentIndex).toBeLessThan(pinnedIndex)

  await deleteWorkflow(page, pinnedLabel)
  await deleteWorkflow(page, frequentLabel)
})

// docs/goals/0015-summon-quick-invoke.md's last open item: a workflow
// row's own Hotkey-trigger combo, the Quick Panel half (command-palette.
// spec.ts covers the ⌘K palette). Real hotkey assignment can't run
// headlessly (see hotkeyDebugKnob.ts's own header comment) --
// assignDebugWorkflowHotkey records the combo server-side the same way
// a real AssignHotkey call would, minus the OS probe.
test('a workflow row shows its own hotkey-trigger combo inline; a non-hotkey trigger shows none', async ({ page }, testInfo) => {
  const hotkeyLabel = 'ZzE2ePanelHotkeyChipX'
  const manualLabel = 'ZzE2ePanelNoHotkeyChip'
  await createHotkeyTriggerWorkflow(page, hotkeyLabel)
  await createSimpleWorkflow(page, manualLabel)

  const client = await connectMCPClient(testInfo.parallelIndex)
  let hotkeyWorkflowId: string
  try {
    hotkeyWorkflowId = await findWorkflowIdByLabel(client, hotkeyLabel)
  } finally {
    await client.close()
  }
  await assignDebugWorkflowHotkey(page, hotkeyWorkflowId, ['CMD', 'SHIFT'], 'M')

  await page.goto('about:blank')
  await page.goto('/#/quickpanel')
  const search = page.getByRole('combobox', { name: 'Quick Panel search' })
  await expect(search).toBeFocused()

  await search.fill(hotkeyLabel)
  const hotkeyOption = page.getByRole('option', { name: hotkeyLabel })
  await expect(hotkeyOption).toBeVisible()
  await expect(hotkeyOption.getByTestId('workflow-hotkey-chip')).toHaveText('⌘⇧M')

  // A manual-trigger row carries no hotkey-chip testid at all -- not
  // just an empty one -- since WorkflowRowTrailingVisual only renders
  // KeyComboChip when a combo is actually present.
  await search.fill(manualLabel)
  const manualOption = page.getByRole('option', { name: manualLabel })
  await expect(manualOption).toBeVisible()
  await expect(manualOption.getByTestId('workflow-hotkey-chip')).toHaveCount(0)

  await deleteWorkflow(page, hotkeyLabel)
  await deleteWorkflow(page, manualLabel)
})
