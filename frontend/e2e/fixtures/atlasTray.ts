import type { Page } from '@playwright/test'

// The tray's own creation surface (goal 0224's tray-restructure slice
// -- "I don't want to give the impression I'm draw.io"): Shape/Pencil/
// Eraser/Laser collapse into the tray's own "Annotate" disclosure
// group instead of rendering flat. At most ONE AnchoredOverlay for the
// whole family is ever mounted at a time (AtlasCreationTray.tsx's own
// header comment has the regression this fixes -- nesting the drawer's
// popover around an armed tool's own style-panel popover broke
// React Flow's Space-to-pan): while nothing in the family is armed,
// the tray shows the generic trigger + a drawer of all four; the
// instant one arms, that tool's own flat button takes over the SAME
// tray slot and the trigger disappears entirely. Every spec that arms
// one of them goes through this ONE helper (testing.md's "a helper
// used by 2+ spec files MUST be promoted" rule) rather than each spec
// re-deriving the same expand-then-click sequence.
const ANNOTATE_GROUP_TESTIDS = new Set(['atlas-tray-shape', 'atlas-tray-pencil', 'atlas-tray-eraser', 'atlas-tray-laser'])

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
  if (!ANNOTATE_GROUP_TESTIDS.has(testid)) {
    await page.getByTestId(testid).click()
    return
  }
  try {
    await page.getByTestId(testid).click({ timeout: DIRECT_CLICK_TIMEOUT_MS })
    return
  } catch {
    // Collapsed (or not yet settled) -- open the Annotate group, then
    // retry with the caller's own default timeout.
  }
  const trigger = page.getByTestId('atlas-tray-annotate-group')
  if (!(await trigger.isVisible())) {
    // The trigger itself is ALSO absent: a DIFFERENT annotate tool is
    // currently armed and occupying this same tray slot (the
    // one-overlay design above). Escape disarms it unconditionally --
    // the same door every other cross-tool arm already goes through --
    // bringing the trigger (and the drawer behind it) back.
    await page.keyboard.press('Escape')
  }
  await trigger.click()
  await page.getByTestId(testid).click()
}
