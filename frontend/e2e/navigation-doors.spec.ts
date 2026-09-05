import type { Locator, Page } from '@playwright/test'
import { test, expect } from './fixtures/server'
import { callBindingViaRPC } from './fixtures/wailsRpc'
import { activePanel, dragPaletteItemToCanvas, workflowRow } from './fixtures/canvas'
import { clickCanvasNode } from './fixtures/canvasNode'
import { paletteDialog } from './fixtures/palette'

// Every "open" door that lands on a workflow reuses that workflow's own
// tab (store.ts's openWorkTab/requestOpenWorkflow, docs/SPEC.md §3.8);
// this spec is the sidebar's own half of that contract (goal 0353): the
// sidebar highlight follows the ACTIVE TAB's owning section, not
// whichever page's `view` the tab was opened over (setView never
// changes when a tab opens -- only activeWorkTabKey does, so `view`
// alone kept highlighting the page a tab was opened FROM, the reported
// defect). Table-driven over every door proven to reuse the same tab.
//
// Shared worker pool: setup goes through the real Go bindings a click
// reaches (fixtures/wailsRpc.ts's callBindingViaRPC, reference-peek.
// spec.ts's own pattern) rather than authoring a workflow through the
// canvas -- this spec is about navigation, not authoring, and canvas
// authoring already has its own coverage (authoring-validation.spec.ts,
// command-palette.spec.ts's createSimpleWorkflow). A lone trigger-manual
// root (NodeTypeID "trigger-manual") is the same minimal, real,
// saveable graph command-palette.spec.ts's createHotkeyTriggerWorkflow
// starts from -- no second step needed since nothing here runs to
// verify output, only that the workflow exists and carries real run
// history for the doors that need one (Activity's run row, Home's Most
// used).
const COMPOSITION = 'github.com/alicoding/mill/internal/services/compositionsvc.CompositionService.'
const EXECUTION = 'github.com/alicoding/mill/internal/services/executionsvc.ExecutionService.'
const CONFIGURE = 'github.com/alicoding/mill/internal/services/configuresvc.ConfigureService.'

// The seed review*.spec.ts's own fixtures already park (codeexec.spec.ts,
// guardrail-authoring.spec.ts): code-execution's Effect is ClassExternal,
// so a first run always asks (docs/adr/0022) with no setup of our own.
const SEED = 'Example: Run copied code'

async function createAndRunWorkflow(page: Page, label: string): Promise<string> {
  const wf = await callBindingViaRPC<{ ID: string }>(page, COMPOSITION + 'CreateWorkflow', [
    label, '', [{ ID: 'n1', Kind: 'trigger', NodeTypeID: 'trigger-manual', Config: {}, Position: { X: 0, Y: 0 } }], [],
  ])
  await callBindingViaRPC(page, EXECUTION + 'RunWorkflow', [wf.ID, 'test', null])
  return wf.ID
}

async function deleteWorkflow(page: Page, id: string): Promise<void> {
  await callBindingViaRPC(page, COMPOSITION + 'DeleteWorkflow', [id])
}

function workflowTab(page: Page, label: string): Locator {
  return page.getByRole('tab', { name: label, exact: true })
}

// The immediate check every door in the table makes: reusing one tab,
// that tab focused, and the sidebar naming the section that OWNS it --
// never the page the tab happened to open over.
async function assertTabIsCurrentSection(page: Page, label: string): Promise<void> {
  await expect(workflowTab(page, label)).toHaveCount(1)
  await expect(workflowTab(page, label)).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('link', { name: 'Workflows' })).toHaveAttribute('aria-current', 'page')
}

// The regression proof: navigating to Review must not steal the
// sidebar highlight away from a still-active tab the wrong direction
// either -- Review becomes current, the tab survives in the strip
// (never closed by navigating away), and a second, DIFFERENT door
// reopens the identical tab rather than a duplicate.
async function assertReviewThenReopenStaysOneTab(page: Page, label: string, reopenViaADifferentDoor: () => Promise<void>): Promise<void> {
  await page.getByRole('link', { name: 'Review' }).click()
  await expect(page.getByTestId('review-view')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Review' })).toHaveAttribute('aria-current', 'page')
  await expect(workflowTab(page, label)).toHaveCount(1)

  await reopenViaADifferentDoor()
  await assertTabIsCurrentSection(page, label)
}

async function reopenViaWorkflowsListRow(page: Page, label: string): Promise<void> {
  await page.getByRole('link', { name: 'Workflows' }).click()
  await workflowRow(page, label).click()
}

async function reopenViaPaletteOpenTarget(page: Page, label: string): Promise<void> {
  await page.keyboard.press('Meta+k')
  await paletteDialog(page).getByRole('combobox').fill(label)
  await paletteDialog(page).getByRole('option', { name: new RegExp(`Open: ${label}`) }).click()
}

// Each case creates and deletes its own workflow rather than sharing
// one across the describe block via beforeAll/afterAll: `baseURL` is a
// test-scoped fixture (fixtures/server.ts), not available to a
// worker-scoped beforeAll -- and a fresh entity per case keeps a failed
// assertion from leaving a later case's setup on a stale workflow.
test.describe('every door that opens a workflow lands in its own one tab, with the sidebar following it', () => {
  const LABEL = 'ZzE2eNavDoorsWorkflow'

  test('Workflows list row', async ({ page }) => {
    await page.goto('/')
    const id = await createAndRunWorkflow(page, LABEL)
    try {
      await page.getByRole('link', { name: 'Workflows' }).click()
      await workflowRow(page, LABEL).click()
      await assertTabIsCurrentSection(page, LABEL)
      await assertReviewThenReopenStaysOneTab(page, LABEL, () => reopenViaPaletteOpenTarget(page, LABEL))
    } finally {
      await deleteWorkflow(page, id)
    }
  })

  test('Activity "Open workflow"', async ({ page }) => {
    await page.goto('/')
    const id = await createAndRunWorkflow(page, LABEL)
    try {
      await page.getByRole('link', { name: 'Activity' }).click()
      await page.getByTestId('activity-run-workflow').filter({ hasText: LABEL }).first().click()
      await assertTabIsCurrentSection(page, LABEL)
      await assertReviewThenReopenStaysOneTab(page, LABEL, () => reopenViaWorkflowsListRow(page, LABEL))
    } finally {
      await deleteWorkflow(page, id)
    }
  })

  test('Home › Most used row', async ({ page }) => {
    await page.goto('/')
    const id = await createAndRunWorkflow(page, LABEL)
    try {
      // The search box scopes a possibly-crowded list down to this
      // run's own row (executionservice_home.go's mostUsedFor is
      // frequency-sorted, not filtered) -- typing the unique label is
      // the same "find my own row regardless of rank" approach every
      // other shared-pool inventory spec already uses.
      await page.getByRole('link', { name: 'Home' }).click()
      await page.getByTestId('inventory-search').fill(LABEL)
      await workflowRow(page, LABEL).click()
      await assertTabIsCurrentSection(page, LABEL)
      await assertReviewThenReopenStaysOneTab(page, LABEL, () => reopenViaWorkflowsListRow(page, LABEL))
    } finally {
      await deleteWorkflow(page, id)
    }
  })

  test('the palette’s workflow target', async ({ page }) => {
    await page.goto('/')
    const id = await createAndRunWorkflow(page, LABEL)
    try {
      await reopenViaPaletteOpenTarget(page, LABEL)
      await assertTabIsCurrentSection(page, LABEL)
      await assertReviewThenReopenStaysOneTab(page, LABEL, () => reopenViaWorkflowsListRow(page, LABEL))
    } finally {
      await deleteWorkflow(page, id)
    }
  })
})

test.describe('every Review door that opens a run’s workflow lands in the same one tab', () => {
  async function parkTheSeed(page: Page): Promise<Locator> {
    await page.getByRole('link', { name: 'Workflows' }).click()
    const row = workflowRow(page, SEED)
    await row.getByRole('button', { name: `Run ${SEED}`, exact: true }).click()
    await page.getByRole('link', { name: 'Review' }).click()
    const item = page.getByTestId('review-item').filter({ hasText: SEED }).first()
    await expect(item).toBeVisible({ timeout: 10_000 })
    return item
  }

  // Denies rather than approves (review-open-run.spec.ts's own choice):
  // no clipboard write to serialize behind a lock, nothing left parked
  // for the next test.
  async function denyTheParkedStep(page: Page): Promise<void> {
    await page.getByTestId('deny-step').click()
    await expect(page.getByTestId('run-detail')).toContainText('denied by user', { timeout: 10_000 })
  }

  test('Review "Open run"', async ({ page }) => {
    await page.goto('/')
    const item = await parkTheSeed(page)
    await item.getByTestId('review-open-run').click()
    await assertTabIsCurrentSection(page, SEED)
    await expect(page.getByRole('tab', { name: 'Runs' })).toBeVisible()
    await expect(page.getByTestId('run-detail')).toBeVisible()
    await denyTheParkedStep(page)
    await assertReviewThenReopenStaysOneTab(page, SEED, () => reopenViaWorkflowsListRow(page, SEED))
  })

  test('Review row click (the workflow name)', async ({ page }) => {
    await page.goto('/')
    const item = await parkTheSeed(page)
    await item.getByTestId('review-item-workflow').click()
    await assertTabIsCurrentSection(page, SEED)
    await expect(page.getByRole('tab', { name: 'Runs' })).toBeVisible()
    await expect(page.getByTestId('run-detail')).toBeVisible()
    await denyTheParkedStep(page)
    await assertReviewThenReopenStaysOneTab(page, SEED, () => reopenViaWorkflowsListRow(page, SEED))
  })
})

// The same bug, the other work-tab kind: a request-view/request-edit
// tab must make Configure current too, even when it's opened from
// INSIDE a workflow's own canvas (a node's reference-field "Open" link,
// configure/ReferencePeek.tsx) -- reference-peek.spec.ts's own recipe,
// minus its assertions, plus this goal's sidebar check.
test('a request tab makes Configure current, opened from inside a workflow’s own canvas', async ({ page }) => {
  await page.goto('/')
  const created = await callBindingViaRPC<{ ID: string }>(page, CONFIGURE + 'CreateHTTPRequest', [
    'ZzE2eNavDoorsRequest', 'https://example.invalid/', '', '', 'bearer', '', {}, '', null, null, '',
  ])
  try {
    await page.getByRole('link', { name: 'Workflows' }).click()
    await page.getByTestId('new-workflow').click()
    await activePanel(page).getByTestId('toggle-palette').click()
    await dragPaletteItemToCanvas(page, 'integration-http')
    const panel = activePanel(page)
    await clickCanvasNode(page, panel, 'Call an API')
    await panel.getByTestId('entity-ref-field').first().selectOption({ label: 'ZzE2eNavDoorsRequest' })
    await panel.getByTestId('entity-ref-peek').first().getByTestId('entity-ref-open').click()

    await expect(page.getByRole('tab', { name: 'ZzE2eNavDoorsRequest', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('link', { name: 'Configure' })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('link', { name: 'Workflows' })).not.toHaveAttribute('aria-current', 'page')
  } finally {
    await callBindingViaRPC(page, CONFIGURE + 'DeleteHTTPRequest', [created.ID])
  }
})
