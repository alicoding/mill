import { expect, test } from './fixtures/server'

// Shared worker pool: reads only its own crash-probe route and the
// boundary's static fallback -- no app state touched.
//
// Regression: a render error anywhere below the root unmounted the
// whole tree into a silent white window (observed live on an installed
// build). The boundary must show the error, a copy affordance, and a
// reload -- proven against the real bundle via the #/millcrashprobe
// seam (AppErrorBoundary.tsx).
test('a render crash shows the error boundary, not a white void', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/#/millcrashprobe`)
  await expect(page.getByTestId('app-error-boundary')).toBeVisible()
  await expect(page.getByTestId('error-details')).toContainText('crash probe')
  await expect(page.getByTestId('error-copy-details')).toBeVisible()
  await expect(page.getByTestId('error-reload')).toBeVisible()
})

test('normal routes are untouched by the boundary', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/`)
  await expect(page.getByTestId('app-error-boundary')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Workflows' })).toBeVisible()
})
