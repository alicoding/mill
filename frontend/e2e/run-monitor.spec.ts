import { test, expect } from './fixtures/server'
import { callBindingViaRPC } from './fixtures/wailsRpc'

// The run monitor window (goal 0294 S2): its own hash route showing one
// workflow's canvas read-only with the run's steps. Shared worker pool:
// the assertions read only the seeded backup workflow's own newest run,
// which this test creates. The real window, its floating level and the
// Quick Panel / tray doors that show it are OS-bound (testing.md's
// manual registry); the route's content is what this proves.
test('the run monitor route shows a workflow canvas with its latest run and an Open in Mill door', async ({ page }) => {
  await page.goto('/')
  // The same RPC the panel's Run fires; the run settles in well under a second.
  await callBindingViaRPC(page, 'github.com/alicoding/mill/internal/services/executionsvc.ExecutionService.RunWorkflow', ['backup-mill-data-workflow', 'test', null])

  await page.goto('about:blank')
  await page.goto('/#/runmonitor?workflow=backup-mill-data-workflow&run=latest')
  await expect(page.getByTestId('run-monitor')).toBeVisible()
  await expect(page.getByTestId('run-monitor-title')).toHaveText('Backup Mill data')
  await expect(page.getByTestId('run-monitor-open-in-mill')).toBeEnabled()
  // The canvas mounts read-only with the workflow's own steps...
  await expect(page.locator('.react-flow__node').first()).toBeVisible()
  expect(await page.locator('.react-flow__node').count()).toBeGreaterThanOrEqual(2)
  // ...and the run it was opened on: the finished bar is up.
  await expect(page.getByTestId('current-step-bar')).toBeVisible()
})

test('the run monitor route with no target explains how to get a run here', async ({ page }) => {
  await page.goto('about:blank')
  await page.goto('/#/runmonitor')
  await expect(page.getByTestId('run-monitor-empty')).toContainText('Run a workflow from the Quick Panel')
  await expect(page.getByTestId('run-monitor-open-in-mill')).toBeDisabled()
})
