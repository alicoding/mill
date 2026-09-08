import type { Page } from '@playwright/test'

// E2E_CPU_THROTTLE=<rate> slows a page's CPU through Chromium's own
// DevTools Protocol emulation (goal 0296): CI runners are a fraction
// of this machine, and the flakes that only reproduce there are load
// races. A 4x throttle locally reproduces the CI shard's timing
// without CI. Extracted from fixtures/server.ts's pooled `page`
// fixture (goal 0358 S8) so a dedicated-server spec's own
// `browser.newPage()` -- which bypasses that fixture entirely -- can
// apply the same rate; CPU throttling is per-page (a CDP session per
// target), so every page a spec opens needs its own call.
export async function applyCpuThrottle(page: Page): Promise<void> {
  const rate = Number(process.env.E2E_CPU_THROTTLE ?? '0')
  if (rate > 1) {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate })
  }
}
