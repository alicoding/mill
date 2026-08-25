import { chromium, expect, test } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { withClipboardLock } from './fixtures/clipboardLock'
import {
  GUARDRAIL_AUTHORING_MCP_BASE_PORT,
  GUARDRAIL_AUTHORING_SERVER_BASE_PORT,
  spawnMillServer,
  type SpawnedServer,
} from './fixtures/server'

// The full guardrail rule-authoring loop across all three doors (goal
// 0078), driven through the seeded "Example: Run copied code" workflow
// -- the cheapest seeded ask example that parks deterministically with
// no external network call (code-execution runs a real but local `echo`
// command, then a real clipboard write, same seed codeexec.spec.ts
// already proves the ambient gate against). The seed IS the proof
// (.claude/rules/testing.md): rule-from-park unsticks the workflow,
// edit-in-context and the audit view both see and change the same
// rule, and removing it really restores the parked default.
//
// Runs on its own dedicated server (fixtures/server.ts's
// GUARDRAIL_AUTHORING_* ports), not the standard per-worker pool: this
// spec asserts EXACT rule counts/groupings in the Rules audit view,
// which must never be contaminated by another spec file sharing a
// worker's server.
const SEED = 'Example: Run copied code'

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('Rule-from-park unsticks the workflow, edit-in-context and the audit view see the same rule, and removing it restores the parked default', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-guardrail-authoring-${idx}-`))
  const settingsPath = path.join(dir, 'settings.json')
  const executionDbPath = path.join(dir, 'execution.db')
  const backupDir = path.join(dir, 'backups')
  const port = GUARDRAIL_AUTHORING_SERVER_BASE_PORT + idx
  const mcpPort = GUARDRAIL_AUTHORING_MCP_BASE_PORT + idx

  let server: SpawnedServer | undefined
  const browser = await chromium.launch()
  try {
    server = await spawnMillServer({ port, mcpPort, settingsPath, executionDbPath, backupDir })
    const page = await browser.newPage()

    // code-execution's apply step really writes to the OS clipboard
    // once allowed -- every run below (approved-from-park, then the
    // auto-allowed second run) needs the lock end to end
    // (.claude/rules/testing.md); the THIRD run below parks and gets
    // denied, never reaching the clipboard step, but stays inside the
    // same lock for simplicity.
    await withClipboardLock(async () => {
      await page.goto(`${server!.baseURL}/`)
      await page.getByRole('link', { name: 'Workflows' }).click()
      const row = page.locator('[data-testid="inventory-row"][data-entity="workflow"]').filter({ has: page.getByText(SEED, { exact: true }) })
      await expect(row).toBeVisible()

      // --- Door 1: rule-from-park ---
      await row.getByRole('button', { name: `Run ${SEED}`, exact: true }).click()
      await page.getByRole('link', { name: 'Review' }).click()
      const item = page.getByTestId('review-item').filter({ hasText: SEED }).first()
      await expect(item).toBeVisible({ timeout: 10_000 })

      await item.getByTestId('review-always-menu').click()
      // The ActionMenu.Overlay portals outside the row's own DOM
      // subtree -- scoped to `page`, not `item`.
      await page.getByTestId('review-always-allow').click()

      const alwaysDialog = page.getByRole('dialog', { name: 'Always allow' })
      await expect(alwaysDialog).toBeVisible()
      await expect(alwaysDialog.getByTestId('review-always-context')).toContainText('Run a command in Example: Run copied code')
      // Least-privilege default: "Only this step" starts selected.
      await expect(alwaysDialog.getByTestId('review-always-scope-step')).toBeChecked()
      const ruleNameInput = alwaysDialog.getByTestId('review-always-rule-name')
      await expect(ruleNameInput).toHaveValue('Allow Run a command in Example: Run copied code')

      await alwaysDialog.getByRole('button', { name: 'Save rule and approve' }).click()
      await expect(alwaysDialog).toBeHidden()
      await expect(page.getByTestId('review-item').filter({ hasText: SEED })).toHaveCount(0, { timeout: 10_000 })

      // --- The unstick proof: a second run of the same workflow never parks ---
      await page.getByRole('link', { name: 'Workflows' }).click()
      await row.getByRole('button', { name: `Run ${SEED}`, exact: true }).click()
      await page.waitForTimeout(1_000) // no observable "definitely didn't park" event to await; a park would show within this window
      await expect(page.getByTestId('review-pending-count')).toHaveCount(0)
      await page.getByRole('link', { name: 'Review' }).click()
      await expect(page.getByTestId('review-item').filter({ hasText: SEED })).toHaveCount(0)

      // --- Door 2: edit-in-context on the step that now carries the rule ---
      await page.getByRole('link', { name: 'Workflows' }).click()
      await row.click()
      // A row opens the canvas read-only (view mode) -- the inspector's
      // own fieldset (NodeConfigFields.tsx) disables every descendant
      // control, including the rule kebab below, until Edit is clicked.
      await page.getByTestId('edit-workflow').click()
      await page.locator('[data-id="example-codeexec-step"]').click()
      const stepRuleRow = page.getByTestId('node-guardrail-rule-row').filter({ hasText: 'Allow Run a command in Example: Run copied code' })
      await expect(stepRuleRow).toBeVisible()
      await expect(stepRuleRow).toContainText('allow')

      await stepRuleRow.getByTestId('node-guardrail-rule-menu').click()
      await page.getByTestId('node-guardrail-rule-edit').click()
      const editDialog = page.getByRole('dialog', { name: 'Edit rule' })
      await expect(editDialog).toBeVisible()
      await editDialog.getByTestId('guardrail-rule-name').fill('Allow the sandboxed echo step')
      await editDialog.getByRole('button', { name: 'Save rule' }).click()
      await expect(editDialog).toBeHidden()
      await expect(page.getByTestId('node-guardrail-rule-row').filter({ hasText: 'Allow the sandboxed echo step' })).toBeVisible()

      // --- Door 3: the Review "Rules" audit view sees the same, edited rule ---
      await page.getByRole('link', { name: 'Review' }).click()
      await page.getByTestId('review-tab-rules').click()
      const panel = page.getByTestId('guardrail-rules-panel')
      await expect(panel).toBeVisible()
      const group = page.getByTestId('guardrail-rules-group').filter({ has: page.getByText(SEED, { exact: true }) })
      await expect(group).toBeVisible()
      const rulesRow = group.getByTestId('guardrail-rule-row').filter({ hasText: 'Allow the sandboxed echo step' })
      await expect(rulesRow).toBeVisible()
      await expect(rulesRow.getByTestId('guardrail-rule-sentence')).toHaveText('Only this step — Run a command in Example: Run copied code')

      // Remove it from the audit view -- the policy-removal half of the proof.
      // Scoped to the group/row THIS TEST created (SEED's own workflow
      // group, and the rule's own edited label) rather than asserting the
      // whole audit view is empty -- a seeded guardrail rule scoped to a
      // DIFFERENT workflow (goal 0203 S2's "Uses a stored secret" example)
      // legitimately persists across this delete, so a global toHaveCount(0)
      // would break again the next time any seeded rule is added.
      await rulesRow.getByTestId('guardrail-rule-menu').click()
      // Same portal caveat as the "Always…" menu above.
      await page.getByTestId('guardrail-rule-remove').click()
      await page.getByRole('button', { name: 'Delete' }).click()
      await expect(page.getByTestId('guardrail-rule-row').filter({ hasText: 'Allow the sandboxed echo step' })).toHaveCount(0)
      await expect(group).toHaveCount(0)

      // --- The rule is really gone: a third run parks again ---
      await page.getByRole('link', { name: 'Workflows' }).click()
      await row.getByRole('button', { name: `Run ${SEED}`, exact: true }).click()
      await page.getByRole('link', { name: 'Review' }).click()
      const thirdParked = page.getByTestId('review-item').filter({ hasText: SEED }).first()
      await expect(thirdParked).toBeVisible({ timeout: 10_000 })
      await thirdParked.getByTestId('review-deny').click()
      await expect(page.getByTestId('review-item').filter({ hasText: SEED })).toHaveCount(0, { timeout: 10_000 })
    })

    await page.close()
  } finally {
    await browser.close()
    if (server) await server.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('Door 2: selecting a step with no matching rule shows the "nothing applies" default', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-guardrail-authoring-nodefault-${idx}-`))
  const settingsPath = path.join(dir, 'settings.json')
  const executionDbPath = path.join(dir, 'execution.db')
  const backupDir = path.join(dir, 'backups')
  // Offset from the main test's own port pair (same worker parallelIndex
  // would otherwise collide across these two tests in this file).
  const port = GUARDRAIL_AUTHORING_SERVER_BASE_PORT + 10 + idx
  const mcpPort = GUARDRAIL_AUTHORING_MCP_BASE_PORT + 10 + idx

  let server: SpawnedServer | undefined
  const browser = await chromium.launch()
  try {
    server = await spawnMillServer({ port, mcpPort, settingsPath, executionDbPath, backupDir })
    const page = await browser.newPage()
    await page.goto(`${server.baseURL}/`)
    await page.getByRole('link', { name: 'Workflows' }).click()
    const row = page.locator('[data-testid="inventory-row"][data-entity="workflow"]').filter({ has: page.getByText(SEED, { exact: true }) })
    await row.click()
    await page.locator('[data-id="example-codeexec-step"]').click()
    await expect(page.getByTestId('node-guardrail-no-rules')).toBeVisible()
    await expect(page.getByTestId('node-guardrail-no-rules')).toHaveText('No rules apply to this step. Its defaults decide.')
  } finally {
    await browser.close()
    if (server) await server.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
