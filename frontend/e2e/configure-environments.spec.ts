// An environment is a named set of variables a run selects (goal 0306
// S5): a plain value is text, a secret one is a pick from the store,
// {{name}} in an integration is substituted at send time, and a run
// that cannot resolve one is refused before it starts. Shared pool:
// everything here is created and deleted by this file.
import { test, expect } from './fixtures/server'
import { gotoAppReady } from './fixtures/appReady'
import { clickRowAction } from './inventoryRow'
import { deleteSecret, ensureVault, secretTitles } from './fixtures/secretStore'
import { callBindingViaRPC } from './fixtures/wailsRpc'

const CONFIGURE = 'github.com/alicoding/mill/internal/services/configuresvc.ConfigureService.'
const COMPOSITION = 'github.com/alicoding/mill/internal/services/compositionsvc.CompositionService.'

interface Entity { ID: string; Label: string }

function environmentRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="environment"]').filter({ has: page.getByText(label, { exact: true }) })
}

function workflowRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="inventory-row"][data-entity="workflow"]').filter({ has: page.getByText(label, { exact: true }) })
}

async function openEnvironments(page: import('@playwright/test').Page) {
  await gotoAppReady(page)
  await page.getByRole('link', { name: 'Configure' }).click()
  await page.getByRole('tab', { name: 'Environments', exact: true }).click()
}

test('an environment holds a plain value and a secret reference, and says which variables still need one', async ({ page }) => {
  await gotoAppReady(page)
  await ensureVault(page)
  await openEnvironments(page)

  await page.getByTestId('new-environment').click()
  await page.getByTestId('environment-label').fill('ZzE2eSandbox')
  await page.getByTestId('environment-var-key').first().fill('API_BASE')
  await page.getByTestId('environment-var-value').first().fill('https://sandbox.example.test')

  await page.getByTestId('environment-add-variable').click()
  await page.getByTestId('environment-var-key').nth(1).fill('API_TOKEN')
  await page.getByTestId('environment-var-secret-toggle').nth(1).check()
  // A secret variable's value is a pick from the store, never typed
  // here -- adding one from this field is the same door every other
  // secret-shaped field uses.
  await page.getByTestId('secret-ref-add').click()
  await expect(page.getByTestId('secret-title-input')).toHaveValue('API_TOKEN')
  await page.getByTestId('secret-title-input').fill('ZzE2eEnvToken')
  await page.getByTestId('secret-password-input').fill('tok-e2e-never-stored-in-the-environment')
  await page.getByRole('button', { name: 'Save', exact: true }).click()

  await page.getByTestId('save-environment').click()

  const row = environmentRow(page, 'ZzE2eSandbox')
  await expect(row).toBeVisible()
  await expect(row).toContainText('2 variables (1 secret)')
  // Both variables have a value, so nothing is outstanding.
  await expect(row.getByText('Needs a value')).toHaveCount(0)

  // What the environment actually holds: a reference, and the token
  // nowhere at all.
  const environments = await callBindingViaRPC<{ ID: string; Label: string; Vars: { Key: string; Value: string; Secret: boolean }[] }[]>(page, CONFIGURE + 'Environments', [])
  const mine = environments.find((e) => e.Label === 'ZzE2eSandbox')
  expect(mine?.Vars.find((v) => v.Key === 'API_TOKEN')?.Value).toMatch(/^vault:/)
  expect(JSON.stringify(environments)).not.toContain('tok-e2e-never-stored-in-the-environment')

  const reference = mine!.Vars.find((v) => v.Key === 'API_TOKEN')!.Value
  await clickRowAction(page, row, 'Delete')
  await expect(environmentRow(page, 'ZzE2eSandbox')).toHaveCount(0)
  const entries = await secretTitles(page)
  expect(entries.some((e) => e.Title === 'ZzE2eEnvToken')).toBe(true)
  await deleteSecret(page, reference)
})

test('a secret variable with nothing picked yet says it needs a value', async ({ page }) => {
  await openEnvironments(page)
  await page.getByTestId('new-environment').click()
  await page.getByTestId('environment-label').fill('ZzE2eIncomplete')
  await page.getByTestId('environment-var-key').first().fill('API_TOKEN')
  await page.getByTestId('environment-var-secret-toggle').first().check()
  await page.getByTestId('save-environment').click()

  const row = environmentRow(page, 'ZzE2eIncomplete')
  await expect(row).toContainText('Needs a value')

  await clickRowAction(page, row, 'Delete')
  await expect(environmentRow(page, 'ZzE2eIncomplete')).toHaveCount(0)
})

test('a name that is not an identifier is refused with the rule, not a stack trace', async ({ page }) => {
  await openEnvironments(page)
  await page.getByTestId('new-environment').click()
  await page.getByTestId('environment-label').fill('ZzE2eBadName')
  await page.getByTestId('environment-var-key').first().fill('api-base')
  await page.getByTestId('save-environment').click()

  await expect(page.getByTestId('environment-form-error')).toContainText('not a usable variable name')
  await expect(environmentRow(page, 'ZzE2eBadName')).toHaveCount(0)
  await page.getByRole('button', { name: 'Cancel' }).click()
})

test('a request naming a variable runs in the environment the dialog picked, and is refused when none can supply it', async ({ page }) => {
  await gotoAppReady(page)
  // Built through the same bound methods the forms call: this test is
  // about the RUN, and authoring an integration and a graph by hand
  // would make it about the canvas instead.
  const environment = await callBindingViaRPC<Entity>(page, CONFIGURE + 'CreateEnvironment', ['ZzE2eRunStage', [{ Key: 'API_BASE', Value: 'http://127.0.0.1:9', Secret: false }]])
  const request = await callBindingViaRPC<Entity>(page, CONFIGURE + 'CreateHTTPRequest', ['ZzE2eStagedRequest', '{{API_BASE}}/echo', 'GET', '', 'none', '', null, '', null, null, ''])
  const workflow = await callBindingViaRPC<Entity>(page, COMPOSITION + 'CreateWorkflow', ['ZzE2eStagedWorkflow', '', [
    { ID: 't', NodeTypeID: 'trigger-manual', Position: { X: 0, Y: 0 } },
    { ID: 'h', NodeTypeID: 'integration-http', Position: { X: 0, Y: 100 }, Config: { requestId: request.ID } },
  ], [{ ID: 'e', Source: 't', Target: 'h' }]])
  // One declared attribute, so Run opens the dialog -- which is where
  // the per-run environment override lives.
  await callBindingViaRPC(page, CONFIGURE + 'UpdateWorkflowAttributes', [workflow.ID, [{ Key: 'note', Label: 'Note', Type: 'text' }]])

  await page.getByRole('link', { name: 'Workflows' }).click()
  const row = workflowRow(page, 'ZzE2eStagedWorkflow')
  await expect(row).toBeVisible()

  // No environment chosen anywhere yet: the run is refused before it
  // starts, naming the variable it could not resolve.
  await row.getByRole('button', { name: 'Run' }).click()
  await expect(page.getByTestId('workflow-environment-picker')).toHaveText('None')
  await page.getByRole('button', { name: 'Run', exact: true }).last().click()
  await expect(page.getByTestId('workflow-run-error')).toContainText('{{API_BASE}}')
  await expect(page.getByTestId('workflow-run-error')).toContainText('no environment is selected')

  // Declaring the workflow's default makes the run dialog appear with
  // that environment already chosen.
  await callBindingViaRPC(page, COMPOSITION + 'SetWorkflowDefaultEnvironment', [workflow.ID, environment.ID])
  await page.reload()
  await page.getByRole('link', { name: 'Workflows' }).click()
  await workflowRow(page, 'ZzE2eStagedWorkflow').getByRole('button', { name: 'Run' }).click()
  await expect(page.getByTestId('workflow-environment-picker')).toHaveText('ZzE2eRunStage')

  // Overriding to None for this one run is obeyed, not silently
  // replaced by the workflow's default.
  await page.getByTestId('workflow-environment-picker').click()
  await page.getByTestId('workflow-environment-none').click()
  await page.getByRole('button', { name: 'Run', exact: true }).last().click()
  await expect(page.getByTestId('workflow-run-error')).toContainText('no environment is selected')

  await callBindingViaRPC(page, COMPOSITION + 'DeleteWorkflow', [workflow.ID])
  await callBindingViaRPC(page, CONFIGURE + 'DeleteHTTPRequest', [request.ID])
  await callBindingViaRPC(page, CONFIGURE + 'DeleteEnvironment', [environment.ID])
})

test('a run records the environment it started in, and the environment cannot be deleted while a workflow targets it', async ({ page }) => {
  await gotoAppReady(page)
  const environment = await callBindingViaRPC<Entity>(page, CONFIGURE + 'CreateEnvironment', ['ZzE2eRecordedStage', [{ Key: 'GREETING', Value: 'hello', Secret: false }]])
  const workflow = await callBindingViaRPC<Entity>(page, COMPOSITION + 'CreateWorkflow', ['ZzE2eRecordedWorkflow', '', [
    { ID: 't', NodeTypeID: 'trigger-manual', Position: { X: 0, Y: 0 } },
    { ID: 'i', NodeTypeID: 'process-inject-text', Position: { X: 0, Y: 100 }, Config: { text: 'done' } },
  ], [{ ID: 'e', Source: 't', Target: 'i' }]])
  await callBindingViaRPC(page, COMPOSITION + 'SetWorkflowDefaultEnvironment', [workflow.ID, environment.ID])

  // An environment a workflow targets is not deletable, and the refusal
  // names what still uses it.
  const refusal = await page.evaluate(async ({ method, id }) => {
    try {
      const res = await fetch(window.location.origin + '/wails/runtime', {
        method: 'POST',
        headers: { 'x-wails-client-id': 'e2e-rpc', 'Content-Type': 'application/json' },
        body: JSON.stringify({ object: 0, method: 0, args: { 'call-id': 'del', methodName: method, args: [id] } }),
      })
      return await res.text()
    } catch (err) {
      return String(err)
    }
  }, { method: CONFIGURE + 'DeleteEnvironment', id: environment.ID })
  expect(refusal).toContain('ZzE2eRecordedWorkflow')

  await page.getByRole('link', { name: 'Workflows' }).click()
  await workflowRow(page, 'ZzE2eRecordedWorkflow').getByRole('button', { name: 'Run' }).click()
  await expect(page.getByTestId('workflow-run-result')).toBeVisible()

  // Activity names the stage the run went to.
  await page.getByRole('link', { name: 'Activity' }).click()
  await expect(page.getByTestId('activity-run-environment').first()).toHaveText('ZzE2eRecordedStage')

  await callBindingViaRPC(page, COMPOSITION + 'DeleteWorkflow', [workflow.ID])
  await callBindingViaRPC(page, CONFIGURE + 'DeleteEnvironment', [environment.ID])
})
