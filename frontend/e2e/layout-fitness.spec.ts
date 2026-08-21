import { test, expect } from './fixtures/server'
import { layoutFitnessBuilder } from './layoutFitnessRule'
import type { Page } from '@playwright/test'
import type { Result } from 'axe-core'

// Goal 0156's layout-fitness audit: every top-level nav route gets the
// mill-layout-scroll custom axe rule run against its `.view-pane`
// subtree, asserting zero violations. Shared worker pool -- every test
// here only navigates and reads computed layout, it creates no data of
// its own, so it's safe alongside every other spec sharing a worker's
// server.
const ROUTES: { name: string; open: (page: Page) => Promise<void>; waitTestId: string }[] = [
  { name: 'Home', open: (page) => page.getByRole('link', { name: 'Home' }).click(), waitTestId: 'home-view' },
  { name: 'Workflows', open: (page) => page.getByRole('link', { name: 'Workflows' }).click(), waitTestId: 'composition-view' },
  { name: 'Configure', open: (page) => page.getByRole('link', { name: 'Configure' }).click(), waitTestId: 'configure-requests' },
  { name: 'Atlas', open: (page) => page.getByRole('link', { name: 'Atlas' }).click(), waitTestId: 'atlas-view' },
  { name: 'Activity', open: (page) => page.getByRole('link', { name: 'Activity' }).click(), waitTestId: 'activity-view' },
  { name: 'Review', open: (page) => page.getByRole('link', { name: 'Review' }).click(), waitTestId: 'review-view' },
  { name: 'Settings', open: (page) => page.getByRole('link', { name: 'Settings' }).click(), waitTestId: 'settings-view' },
  { name: 'Docs', open: (page) => page.getByTestId('footer-docs-link').click(), waitTestId: 'docs-view' },
]

// Actionable straight from CI output, no trace.zip needed: axe already
// gives a unique CSS selector per violating node (`target`) and this
// repo's own check attaches the trapped px delta / undeclared axis via
// `this.data()` (layoutFitnessRule.ts) -- both land in the rendered
// message.
function formatViolations(violations: Result[]): string {
  return violations
    .flatMap((violation) => violation.nodes.map((node) => {
      const selector = node.target.join(' ')
      const message = node.any[0]?.message ?? violation.description
      return `${selector} -- ${message}`
    }))
    .join('\n')
}

for (const route of ROUTES) {
  test(`layout fitness: ${route.name} has no undeclared scrollers or trapped overflow`, async ({ page }) => {
    await page.goto('/')
    await route.open(page)
    await expect(page.getByTestId(route.waitTestId)).toBeVisible()
    const results = await layoutFitnessBuilder(page).analyze()
    // incomplete means the check itself errored (a ReferenceError inside
    // the injected evaluate, say) -- distinct from violations, and just
    // as fatal: an errored check silently reports zero violations no
    // matter what the page actually does, which is exactly the false
    // green this assertion exists to catch.
    expect(results.incomplete, formatViolations(results.incomplete)).toEqual([])
    expect(results.violations, formatViolations(results.violations)).toEqual([])
  })
}

// Pinned regression (docs/goals/0156-frontend-fitness-functions.md):
// reproduces the exact shape PR #324 fixed -- a `.view-pane` whose OWN
// scrollHeight equals its clientHeight (nothing to wheel-scroll at the
// real scroller) because its only child silently clamps far taller
// content behind `overflow:hidden`. Proves the rule actually catches
// the class that shipped, not just that it runs.
test('pinned regression: a clamped page-panel-shaped trap is reported as a violation', async ({ page }) => {
  await page.setContent(`
    <div class="view-pane" style="height:400px; overflow-y:auto;">
      <div id="trap" style="height:400px; overflow:hidden;">
        <div style="height:2000px;">tall content that never gets a wheel-reachable scroller</div>
      </div>
    </div>
  `)
  const results = await layoutFitnessBuilder(page).analyze()
  expect(results.incomplete, formatViolations(results.incomplete)).toEqual([])
  expect(results.violations.length).toBeGreaterThan(0)
  const trapped = results.violations[0].nodes.find((node) => node.target.join(' ').includes('trap'))
  expect(trapped, formatViolations(results.violations)).toBeTruthy()
})
