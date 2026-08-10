import { chromium, expect } from '@playwright/test'

// Isolation guard (the durable fix for the wrong-server incident class,
// .claude/rules/testing.md): before ANY test runs, prove the server the
// suite is about to exercise is running against isolated MILL_* data --
// the same IsIsolatedData signal the human-facing TEST DATA badge
// renders. A server on real desktop data aborts the whole suite loudly
// instead of silently reading/writing the user's actual store, which
// happened for real once (a bare mill-server without env held the port
// and the suite ran against ~/Library/Application Support/mill).
export default async function globalSetup() {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.goto('http://localhost:8080/')
    await expect(
      page.getByTestId('isolated-data-badge'),
      'Server is NOT running on isolated MILL_* data — refusing to run the suite against what may be the real desktop store',
    ).toBeVisible({ timeout: 15_000 })
  } finally {
    await browser.close()
  }
}
