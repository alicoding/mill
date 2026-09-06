import type { Locator, Page } from '@playwright/test'

// The board's creation dock (goal 0355): seven fixed buttons, two of
// which are FLYOUTS -- Media (Image and every file-backed noun) and
// Annotate (shape/pencil/eraser/laser). At most ONE AnchoredOverlay in
// the family is ever mounted at a time (AtlasCreationTray.tsx's own
// header comment has the regression this prevents -- nesting a
// flyout's popover around an armed tool's style panel broke React
// Flow's Space-to-pan): while nothing in a family is armed, the dock
// shows the flyout trigger; the instant one of its tools arms, that
// tool's own button takes over the SAME slot and the trigger
// disappears entirely. Every spec that arms one of them goes through
// this ONE helper (testing.md's "a helper used by 2+ spec files MUST
// be promoted" rule) rather than each spec re-deriving the same
// expand-then-click sequence.
const FLYOUT_TRIGGER_FOR: Record<string, string> = {
  'atlas-tray-shape': 'atlas-tray-annotate-group',
  'atlas-tray-pencil': 'atlas-tray-annotate-group',
  'atlas-tray-eraser': 'atlas-tray-annotate-group',
  'atlas-tray-laser': 'atlas-tray-annotate-group',
  'atlas-tray-image': 'atlas-tray-media-group',
}

// Mirrors fixtures/toolbarActions.ts's own openToolbarAction shape
// exactly, including its own header comment's reasoning: a snapshot-
// then-click split (an `isVisible()` read followed by a separate
// click call) can observe "visible" and then click an element that
// has since changed state, hanging for the row's full actionability
// timeout. A single bounded click either succeeds inside the window or
// fails once, cleanly, into the fallback below -- never a stale
// snapshot driving a decision a moment later.
const DIRECT_CLICK_TIMEOUT_MS = process.env.CI ? 5000 : 2000

export async function clickAtlasTrayTool(page: Page, testid: string): Promise<void> {
  const triggerTestid = FLYOUT_TRIGGER_FOR[testid]
  if (!triggerTestid) {
    await page.getByTestId(testid).click()
    return
  }
  try {
    await page.getByTestId(testid).click({ timeout: DIRECT_CLICK_TIMEOUT_MS })
    return
  } catch {
    // Collapsed (or not yet settled) -- open the flyout, then retry
    // with the caller's own default timeout.
  }
  const trigger = page.getByTestId(triggerTestid)
  if (!(await trigger.isVisible())) {
    // The trigger itself is ALSO absent: a DIFFERENT tool of the same
    // family is armed and occupying this slot (the one-overlay design
    // above). Escape disarms it unconditionally -- the same door every
    // other cross-tool arm already goes through -- bringing the trigger
    // (and the flyout behind it) back.
    await page.keyboard.press('Escape')
  }
  await trigger.click()
  await page.getByTestId(testid).click()
}

// A tool with no dock button of its own -- every plugin face that
// declares no group (goal 0355) -- is armed from the dock's More panel,
// found by the name its own row shows. The ONE helper every spec uses,
// so "where does a plugin tool live" is answered in one place.
export async function armToolFromMorePanel(page: Page, name: string): Promise<void> {
	await page.getByTestId('atlas-tray-more').click()
	await page.getByTestId('atlas-more-panel').waitFor({ state: 'visible' })
	await page.getByTestId('atlas-more-search').fill(name)
	await page.getByTestId('atlas-more-panel').getByText(name, { exact: true }).first().click()
}

// A tool's presence in the dock's More panel WITHOUT arming it: the
// door every "did this plugin's tool load" check goes through (a
// grandfathered/allowed/blocked plugin proving its face is or isn't
// reachable), handing back the matching row so the caller's own
// expect() keeps Playwright's usual auto-retry instead of a one-shot
// read. Reuses an already-open panel rather than re-clicking the
// trigger (which TOGGLES it shut) -- callers checking two names in a
// row after one boot share the same open panel; press Escape once done
// to leave the dock clean for whatever the test does next.
export async function moreToolRow(page: Page, name: string): Promise<Locator> {
	const panel = page.getByTestId('atlas-more-panel')
	if (!(await panel.isVisible())) {
		await page.getByTestId('atlas-tray-more').click()
		await panel.waitFor({ state: 'visible' })
	}
	await page.getByTestId('atlas-more-search').fill(name)
	return panel.getByText(name, { exact: true })
}
