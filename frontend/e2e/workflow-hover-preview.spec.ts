import { test, expect } from '@playwright/test'

// docs/SPEC.md §3.8's hover-preview pattern (n8n/Oscilar), over real Go
// bindings: hovering a workflow reference shows that workflow's actual
// layout in a small read-only canvas, and Open jumps straight into its
// editor tab. Exercised on the seeded parent→child pair -- the seed IS
// the proof (standing seeded-examples principle).

function workflowRow(page: import('@playwright/test').Page, label: string) {
  return page.locator('[data-testid="workflow-row"]', { has: page.getByText(label, { exact: true }) })
}

test('Hovering the child-workflow NODE previews the child without blanking the parent canvas; Open jumps to its editor', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()

  // Open the seeded parent's canvas -- the child-workflow node card
  // itself is the hover anchor (corrected per direct feedback), no
  // click/selection needed first.
  await workflowRow(page, 'Example: Parent → child call').getByRole('button', { name: /Edit/ }).click()
  const panel = page.locator('[role="tabpanel"]:not([hidden])').last()
  const childNode = panel.locator('.react-flow__node', { hasText: 'Run another workflow' })
  await expect(childNode).toBeVisible()
  await childNode.hover()

  const preview = page.getByTestId('workflow-preview')
  await expect(preview).toBeVisible()
  await expect(preview.getByText('Example: Echo message (callable child)')).toBeVisible()
  // The child's real layout renders (its own React Flow instance with
  // its three nodes), not just a text summary.
  await expect(preview.locator('.react-flow__node')).toHaveCount(3)
  // Regression (caught live): the preview's nested React Flow used to
  // join the parent canvas's store and EMPTY it -- the parent's two
  // nodes must still be on its canvas while the preview is open
  // (the overlay portals outside the tabpanel, so this scope only
  // counts the parent's own nodes).
  await expect(panel.locator('.react-flow__node')).toHaveCount(2)

  await preview.getByTestId('workflow-preview-open').click()
  // The child's own editor tab opens and becomes active.
  await expect(page.getByRole('tab', { name: 'Example: Echo message (callable child)' })).toBeVisible()

  // Cleanup: close both opened editor tabs (nothing was saved) -- the
  // close affordance is a sibling of the tab, not inside it
  // (shared/Tabs.tsx), so target it by its own label.
  await page.getByRole('button', { name: 'Close tab' }).last().click()
  await page.getByRole('button', { name: 'Close tab' }).last().click()
  await expect(page.getByRole('button', { name: 'Close tab' })).toHaveCount(0)
})
