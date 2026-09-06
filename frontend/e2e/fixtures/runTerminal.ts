import { expect } from '@playwright/test'
import type { Locator } from '@playwright/test'

// A workflow run's time to its terminal state is real work a real
// mill-server executes -- step execution, engine bookkeeping, and the
// page's own status refresh all queue behind whatever else the machine
// is running, so it scales with CPU contention, not with a fixed
// local-comfortable budget. The 10-15s ceilings the live-run specs each
// carried were that local-comfortable budget: under CI shard contention
// they expired with the run mid-flight, and that expiry was the
// "live-run" quarantine class. One budget here replaces them -- sized
// for a contended runner, scaled by the declared E2E_CPU_THROTTLE=rate
// repro multiplier when one is in effect, and capped below the suite's
// 90s test ceiling so a genuine hang still fails with the assertion's
// own locator-rich message instead of a bare test timeout.
const cpuThrottle = Number(process.env.E2E_CPU_THROTTLE ?? '0')

export const RUN_TERMINAL_TIMEOUT = Math.min(75_000, 45_000 * (cpuThrottle > 1 ? cpuThrottle : 1))

// The one door for "the run I started reached the state I'm waiting
// on": the run-state dock (or an equivalent run-detail surface) shows
// the awaited marker -- terminal or parked -- within the load-aware
// budget.
export async function waitForRunTerminal(runSurface: Locator, text: string | RegExp = 'SUCCESS'): Promise<void> {
  await expect(runSurface).toContainText(text, { timeout: RUN_TERMINAL_TIMEOUT })
}
