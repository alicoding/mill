import { test, expect } from './fixtures/server'
import { EXEMPT_RULE_IDS, wcagAuditBuilder } from './wcagAuditRule'
import type { Page } from '@playwright/test'
import type { Result } from 'axe-core'

// Goal 0157: axe-core's own bundled WCAG 2 A/AA rule set, run
// read-only across the same routes goal 0156's layout-fitness audit
// covers, plus the Atlas companion panel (goal 0101) as a ninth
// audited state -- a second, independent pass over the same
// machinery, never merged into layoutFitnessBuilder's custom-rule-only
// scope (wcagAuditRule.ts's own header comment explains why).
const ROUTES: { name: string; open: (page: Page) => Promise<void>; waitTestId: string }[] = [
  { name: 'Home', open: (page) => page.getByRole('link', { name: 'Home' }).click(), waitTestId: 'home-view' },
  { name: 'Workflows', open: (page) => page.getByRole('link', { name: 'Workflows' }).click(), waitTestId: 'composition-view' },
  { name: 'Configure', open: (page) => page.getByRole('link', { name: 'Configure' }).click(), waitTestId: 'configure-requests' },
  { name: 'Atlas', open: (page) => page.getByRole('link', { name: 'Atlas' }).click(), waitTestId: 'atlas-view' },
  { name: 'Activity', open: (page) => page.getByRole('link', { name: 'Activity' }).click(), waitTestId: 'activity-view' },
  { name: 'Review', open: (page) => page.getByRole('link', { name: 'Review' }).click(), waitTestId: 'review-view' },
  { name: 'Settings', open: (page) => page.getByRole('link', { name: 'Settings' }).click(), waitTestId: 'settings-view' },
  { name: 'Docs', open: (page) => page.getByTestId('footer-docs-link').click(), waitTestId: 'docs-view' },
  {
    name: 'Atlas + companion panel',
    open: async (page) => {
      await page.getByRole('link', { name: 'Atlas' }).click()
      await page.getByTestId('atlas-open-companion').click()
    },
    waitTestId: 'companion-panel',
  },
]

// Same actionable-output shape as layout-fitness.spec.ts's own
// formatViolations -- axe's `target` is already a unique CSS selector
// per violating node.
function formatViolations(violations: Result[]): string {
  return violations
    .flatMap((violation) => violation.nodes.map((node) => {
      const selector = node.target.join(' ')
      const message = node.any[0]?.message ?? violation.description
      return `${violation.id}: ${selector} -- ${message}`
    }))
    .join('\n')
}

for (const route of ROUTES) {
  test(`wcag audit: ${route.name} has no unexempted WCAG 2 A/AA violations`, async ({ page }) => {
    await page.goto('/')
    await route.open(page)
    await expect(page.getByTestId(route.waitTestId)).toBeVisible()
    const results = await wcagAuditBuilder(page).analyze()
    const unexempted = results.violations.filter((v) => !(v.id in EXEMPT_RULE_IDS))
    expect(unexempted, formatViolations(unexempted)).toEqual([])
  })
}
