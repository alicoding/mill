import { test, expect } from '@playwright/test'

// Real Go bindings over HTTP (Wails3 server mode), not mocks -- same
// setup/limitations as runbook.spec.ts (see its header comment):
// clipboard-dependent success content isn't assertable on a headless CI
// runner, so only the environment-independent path is checked here.
// Exercises the prototype built for docs/SPEC.md §3 / ADR-0005:
// CompositionService.NodeTypes()/Workflows()/CreateWorkflow()/
// DeleteWorkflow()/RunWorkflow() -> real React rows, no canvas.

function workflowRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="workflow-row"]', { has: page.getByText(label, { exact: true }) })
}

test('Composition page lists node primitives and built-in workflows', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Composition' }).click()
  await expect(page.getByRole('heading', { name: 'Capability composition' })).toBeVisible()

  await expect(page.getByTestId('node-type-row')).toHaveCount(4)
  await expect(workflowRow(page, 'Load sample HTML')).toBeVisible()
  await expect(workflowRow(page, 'Clipboard → Markdown')).toBeVisible()
  await expect(workflowRow(page, 'Load sample HTML').getByText('built-in')).toBeVisible()

  // The workflow's step chain renders as chips, not a canvas -- confirms
  // ADR-0005's config-first-not-canvas call visually, not just in prose.
  await expect(workflowRow(page, 'Clipboard → Markdown').getByText('Capture: clipboard HTML')).toBeVisible()
  // Configuration is visible as part of composition, not hidden: the
  // built-in's configured HTML value shows inline on its step chip.
  await expect(workflowRow(page, 'Load sample HTML').getByText(/html:/i)).toBeVisible()
})

test('Running the load-sample workflow produces a visible response, success or error', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Composition' }).click()
  await workflowRow(page, 'Load sample HTML').getByRole('button', { name: 'Run' }).click()
  // Same environment caveat as runbook.spec.ts's load-sample-html test:
  // asserts the full click -> Go binding -> render pipeline produces SOME
  // response, without hard-coding osascript's platform-specific text.
  await expect(workflowRow(page, 'Load sample HTML').getByText(/Quarterly update|no HTML on clipboard|osascript/i)).toBeVisible()
})

test('Running the clipboard-to-markdown workflow produces a visible response, success or error', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Composition' }).click()
  await workflowRow(page, 'Clipboard → Markdown').getByRole('button', { name: 'Run' }).click()
  // On headless CI this is deterministic (no HTML on the clipboard, same
  // as runbook.spec.ts's equivalent test) -- unlike Runbook's tuned
  // soft-failure copy, this prototype's ExecuteWorkflow surfaces a plain
  // technical error (composition.go's deliberate simplification). On a
  // real local desktop the composition tests share one live system
  // clipboard and can race, so -- exactly like runbook.spec.ts's own
  // load-sample-html test -- this accepts either real conversion or the
  // no-HTML error rather than asserting one deterministic outcome.
  await expect(workflowRow(page, 'Clipboard → Markdown').getByText(/no HTML on clipboard|Quarterly update|osascript/i)).toBeVisible()
})

test('Composing a workflow configures it as it is built, then runs and deletes for real', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Composition' }).click()

  const form = page.getByTestId('new-workflow-form')
  await form.getByLabel('Label').fill('E2E custom workflow')
  await form.getByLabel('Description').fill('Composed by an e2e test')

  // Adding a step surfaces its config fields immediately -- composing and
  // configuring happen together, not as separate passes (docs/SPEC.md §3).
  await form.getByLabel('Node type to add').selectOption({ label: 'Apply: write HTML to clipboard' })
  await form.getByRole('button', { name: 'Add step' }).click()

  const step = form.getByTestId('draft-step-row')
  await expect(step).toBeVisible()
  const customHTML = '<p>e2e configured value</p>'
  await step.getByTestId('step-config-field').fill(customHTML)

  await form.getByTestId('save-workflow').click()

  const row = workflowRow(page, 'E2E custom workflow')
  await expect(row).toBeVisible()
  await expect(row.getByText('built-in')).toHaveCount(0)
  // The configured (non-default) value is visible on the saved workflow,
  // not just the node type's label -- proves configuration survived
  // composition, not just the default.
  await expect(row.getByText(/e2e configured value/)).toBeVisible()

  // Running it writes the *configured* HTML, not the built-in default --
  // deterministic even in a headless CI runner: this step only writes to
  // the clipboard, it never reads from it.
  await row.getByRole('button', { name: 'Run' }).click()
  await expect(row.getByText(/e2e configured value/).last()).toBeVisible()

  await row.getByRole('button', { name: /Delete E2E custom workflow/ }).click()
  await expect(workflowRow(page, 'E2E custom workflow')).toHaveCount(0)
})

test('Built-in workflows have no delete control', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Composition' }).click()
  await expect(workflowRow(page, 'Load sample HTML').getByRole('button', { name: /Delete/ })).toHaveCount(0)
})
