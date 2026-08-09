import { test, expect } from '@playwright/test'

// Exercises the single execution path end-to-end (docs/adr/0004,
// docs/adr/0008) through its current UI home: a workflow's own Runs tab
// (docs/SPEC.md §7's Update -- durable-run history/redrive moved off a
// standalone page reached via a workflow picker, into the workflow it
// belongs to, matching real precedent n8n/Retool/Airflow all converge
// on). Real Go bindings over HTTP (Wails3 server mode), not mocks.
// "Load sample HTML" is used throughout (matching composition.spec.ts's
// own choice for the identical reason): it only writes to the
// clipboard, never reads from it, so it's the one built-in workflow
// whose outcome doesn't depend on pre-existing clipboard state -- still
// hedged for osascript failing on a headless runner with no GUI
// pasteboard session (SPEC.md §1.3), same as every other
// clipboard-touching e2e test in this repo.

function workflowRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="workflow-row"]', { has: page.getByText(label, { exact: true }) })
}

// .last(), same reasoning as composition.spec.ts's own activePanel(): a
// saved workflow's editor tab nests a Canvas/Runs tablist inside the
// outer per-workflow tab, so document order (outer panel opens first)
// makes .last() resolve to the innermost, currently-visible one.
function activePanel(page: import('@playwright/test').Page) {
  return page.locator('[role="tabpanel"]:not([hidden])').last()
}

// Scoped by the workflow's own label, not activePanel()/unscoped --
// docs/SPEC.md §3.7's state-persistence feature restores previously-
// opened editor tabs across a page reload, so a test that runs after
// another one in this same file (which left a tab open) can have more
// than one workflow's Canvas/Runs tablist on the page at once. The
// outer per-workflow TabPanel's own accessible name is its workflow's
// label (confirmed via a real accessibility snapshot), and it contains
// its own inner tablist as a descendant, so this reliably finds the
// right one regardless of how many editor tabs are currently open.
function runsTab(page: import('@playwright/test').Page, workflowLabel: string) {
  return page.getByRole('tabpanel', { name: workflowLabel }).getByRole('tab', { name: 'Runs' })
}

// Closes workflowLabel's own editor tab -- every test below opens one;
// leaving it open would persist across a reload (docs/SPEC.md §3.7) and
// pollute later tests/files with an extra open tab, the exact ambiguity
// runsTab()'s own scoping had to work around once already. Filters the
// outer Workflows tablist for the wrapper div that has this specific
// tab as a descendant, then finds its sibling Close-tab control within
// that same wrapper (Tabs.tsx renders Close as a DOM sibling of the tab
// button, not a descendant of it).
async function closeEditorTab(page: import('@playwright/test').Page, workflowLabel: string) {
  const tablist = page.getByRole('tablist', { name: 'Open work' })
  await tablist.locator('div', { has: page.getByRole('tab', { name: workflowLabel, exact: true }) })
    .getByLabel('Close tab')
    .click()
}

test('Running a workflow from its list row, then opening its Runs tab, shows a real status', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  const row = workflowRow(page, 'Load sample HTML')
  const runButton = row.getByRole('button', { name: 'Run' })
  await runButton.click()
  // The run is synchronous server-side (ExecutionService.RunWorkflow
  // blocks on handle.GetResult()) -- the button re-enabling is a real,
  // outcome-independent completion signal, unlike waiting on the row's
  // own inline result <pre> (success-only; ERROR only shows text).
  await expect(runButton).toBeEnabled({ timeout: 15_000 })

  await row.getByRole('button', { name: /Edit/ }).click()
  await runsTab(page, 'Load sample HTML').click()

  const runsPanel = page.getByTestId('workflow-runs-panel')
  await expect(runsPanel).toBeVisible()
  const statusLabel = runsPanel.locator('table').getByText(/^(SUCCESS|ERROR)$/).first()
  await expect(statusLabel).toBeVisible({ timeout: 15_000 })

  await closeEditorTab(page, 'Load sample HTML')
})

test('Viewing a run on its workflow Runs tab shows the per-step breakdown', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  const row = workflowRow(page, 'Load sample HTML')
  const runButton = row.getByRole('button', { name: 'Run' })
  await runButton.click()
  await expect(runButton).toBeEnabled({ timeout: 15_000 })

  await row.getByRole('button', { name: /Edit/ }).click()
  await runsTab(page, 'Load sample HTML').click()

  const runsPanel = page.getByTestId('workflow-runs-panel')
  await expect(runsPanel.locator('table').getByText(/^(SUCCESS|ERROR)$/).first()).toBeVisible({ timeout: 15_000 })
  await runsPanel.getByRole('button', { name: 'View' }).first().click()

  const detail = page.getByTestId('run-detail')
  await expect(detail).toBeVisible()
  // "Load sample HTML" is a single-node workflow (apply-clipboard-write-
  // html) -- its one step's own NodeType label must appear in the
  // breakdown regardless of whether the underlying clipboard write
  // itself succeeded.
  await expect(detail.getByText('Apply: write HTML to clipboard')).toBeVisible()

  await closeEditorTab(page, 'Load sample HTML')
})

test('A workflow with no runs yet shows an empty state on its Runs tab, scoped to that workflow only', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  // Compose and save a brand-new workflow -- guaranteed zero run history,
  // unlike "Load sample HTML" which other tests in this suite may have
  // already run.
  await page.getByTestId('new-workflow').click()
  await page.getByLabel('Label').click()
  await page.getByLabel('Label').fill('E2E runs-empty-state workflow')
  await page.getByTestId('save-workflow').click()

  const row = workflowRow(page, 'E2E runs-empty-state workflow')
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: /Edit/ }).click()
  await runsTab(page, 'E2E runs-empty-state workflow').click()

  const runsPanel = page.getByTestId('workflow-runs-panel')
  await expect(runsPanel.getByText(/No runs yet/)).toBeVisible()

  // Cleanup: delete is a Workflows-list row action, not something inside
  // the editor tab itself -- also closes the tab, no separate
  // closeEditorTab call needed.
  await page.getByRole('tab', { name: 'Workflows' }).click()
  await row.getByRole('button', { name: /Delete/ }).click()
  await expect(row).toHaveCount(0)
})

test('A brand-new, unsaved workflow has no Runs tab -- nothing to show run history for yet', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  await page.getByTestId('new-workflow').click()
  await expect(activePanel(page).getByRole('tab', { name: 'Runs' })).toHaveCount(0)
})
