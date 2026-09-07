import { test, expect } from './fixtures/server'
import type { Page } from '@playwright/test'
import { gotoAppReady } from './fixtures/appReady'

// The top-level document's Content-Security-Policy (goal 0375 S1a,
// frontend/index.html): this spec is the live counterpart to
// indexHtmlCsp.test.ts's static parse -- it proves the policy the
// browser actually enforces never fires a securitypolicyviolation on
// either of the two document shapes Mill mounts: the app's own DOM
// (the landing board) and a sandboxed plugin's srcdoc frame (Roadmap,
// which already carries its own per-frame policy from
// pluginFrameBootstrap.ts -- this spec proves the outer policy doesn't
// ALSO block anything the frame needs from the parent document, e.g.
// the iframe element itself under frame-src).
//
// Shared pool (testing.md): every assertion reads only the violation
// count this test's own probe collects -- no entity created or read.

// Probe code is the test's own, never app code (goal 0375 S1a brief):
// registered via addInitScript so it is attached before ANY script in
// a freshly navigated document runs, catching a violation fired during
// the earliest parse -- a page.evaluate() added after goto() could
// already be too late for that.
async function armCSPProbe(page: Page): Promise<() => Promise<Array<{ directive: string; blockedURI: string }>>> {
  const violations: Array<{ directive: string; blockedURI: string }> = []
  await page.exposeFunction('__reportCSPViolation', (v: { directive: string; blockedURI: string }) => {
    violations.push(v)
  })
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the init-script global Playwright's exposeFunction installs
      ;(window as any).__reportCSPViolation({ directive: e.violatedDirective, blockedURI: e.blockedURI })
    })
  })
  return async () => violations
}

test('the landing board renders with zero CSP violations', async ({ page }) => {
  const readViolations = await armCSPProbe(page)
  await gotoAppReady(page)
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()
  expect(await readViolations()).toEqual([])
})

test('a framed plugin view (Roadmap) renders with zero CSP violations', async ({ page }) => {
  const readViolations = await armCSPProbe(page)
  await gotoAppReady(page)
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()
  await page.getByTestId('atlas-open-plugin-mill-roadmap-roadmap').click()
  const host = page.getByTestId('plugin-view-mill-roadmap-roadmap')
  await expect(host).toBeVisible()
  const frame = page.frameLocator('[data-testid="plugin-view-mill-roadmap-roadmap"]')
  await expect(frame.locator('body')).toBeVisible()
  expect(await readViolations()).toEqual([])
})
