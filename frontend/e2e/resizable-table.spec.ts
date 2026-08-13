import type { Locator } from '@playwright/test'
import { test, expect } from './fixtures/server'

// The shared long-column table pattern (shared/ResizableTable.tsx):
// drag-resizable columns on every DataTable surface, plus truncated
// cells that reveal their full value on hover via the native title
// tooltip. Verified live during the tab-shell session against the
// Integrations table; committed here per .claude/rules/testing.md so
// the manual reproduction isn't lost. Uses the seeded built-in
// requests (top-up seeding guarantees they exist on a fresh store), so
// nothing is created and nothing needs cleanup.
//
// PROPER fix for the drag-timing flake (docs/goals/BACKLOG.md Standing
// #10), applied on its third confirmed recurrence post-hardening (PR
// #24 original, #43, #44 -- the `expect.poll` non-null check added in
// PR #33's wave was insufficient; "three strikes" ruled out another
// timeout bump). Two structural changes, not a bigger number:
// - `waitForStableBoundingBox` below replaces the old "poll until
//   non-null" wait with "poll until non-null AND UNCHANGED across two
//   consecutive reads" -- a non-null box mid-reflow (Primer's DataTable
//   still settling its own --grid-template-columns after becoming
//   visible) was always a real possibility the old check couldn't see,
//   since a box can be non-null and still moving.
// - `test.describe.configure({ mode: 'serial' })`: makes this file's
//   own "these two tests must never interleave" requirement an
//   explicit, self-documenting guarantee at the file level, rather
//   than an incidental side effect of playwright.config.ts's global
//   `fullyParallel: false` (which could change without this file
//   noticing). A keyboard-driven resize alternative (this task's third
//   candidate option) was checked and ruled out: shared/ResizableTable.tsx's
//   drag handle is built entirely on pointerdown/pointermove/pointerup
//   listeners with no keyboard handler at all, so "use keyboard instead
//   of a synthesized drag" would mean building new component behavior,
//   not a test-only fix -- real scope creep beyond a flake fix.

// Polls until a locator's bounding box is not only present but IDENTICAL
// across two consecutive reads -- a plain non-null check (the previous
// fix) can still observe a box mid-layout-reflow, since "has a box" and
// "the box has stopped moving" are different conditions. Local to this
// file since it's this spec's own recurring flake, not (yet) a
// cross-spec pattern worth promoting to a shared e2e helper.
async function waitForStableBoundingBox(locator: Locator, timeout = 5_000) {
  let previous: { x: number; y: number; width: number; height: number } | null = null
  await expect
    .poll(
      async () => {
        const box = await locator.boundingBox()
        if (!box) return false
        const stable = previous !== null
          && box.x === previous.x && box.y === previous.y
          && box.width === previous.width && box.height === previous.height
        previous = box
        return stable
      },
      { timeout },
    )
    .toBe(true)
  if (!previous) throw new Error('resize handle never produced a bounding box')
  return previous as { x: number; y: number; width: number; height: number }
}

test.describe('Resizable table', () => {
  test.describe.configure({ mode: 'serial' })

  test('Table columns are drag-resizable and long cells truncate with a hover title', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Configure' }).click()
    await page.getByRole('button', { name: 'Table view' }).click()

    const table = page.getByRole('table', { name: 'Integrations' })
    await expect(table).toBeVisible()

    // Every header except the last gets a resize handle.
    const handles = table.locator('[data-testid="column-resize-handle"]')
    const headerCount = await table.locator('thead th').count()
    await expect(handles).toHaveCount(headerCount - 1)

    // Dragging the first handle rewrites the grid's first track width.
    const firstTrack = () =>
      table.evaluate((t) => parseFloat(getComputedStyle(t).gridTemplateColumns.split(' ')[0]))
    const before = await firstTrack()
    const box = await waitForStableBoundingBox(handles.first())
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    // Discrete, individually-awaited move calls, not one
    // page.mouse.move(..., { steps: N }) -- Playwright's own `steps`
    // option dispatches every interpolated sub-move as fast as possible
    // within a SINGLE CDP command, which is exactly the shape a
    // browser's real pointermove-coalescing behavior (documented via
    // the PointerEvent getCoalescedEvents() API, not Playwright-
    // specific) can collapse down to just the final position -- under
    // real load, that final dispatch can itself still be racing
    // ResizableTable.tsx's synchronous onMove handler when the very
    // next command (mouse.up()) fires. Awaiting each move individually
    // gives the renderer a real yield point between them.
    const dragSteps = 6
    for (let i = 1; i <= dragSteps; i++) {
      await page.mouse.move(x + (120 * i) / dragSteps, y)
    }
    // Wait for the drag's own effect to actually land in the DOM BEFORE
    // releasing -- a second, distinct timing hazard from the bounding-box
    // one waitForStableBoundingBox guards above: even with discrete moves
    // above, `await page.mouse.move()` resolving doesn't itself guarantee
    // the page's own onMove listener has finished running by the time the
    // NEXT command dispatches. Polling for the expected width (not a
    // fixed sleep) before releasing removes that race deterministically.
    await expect.poll(() => firstTrack(), { timeout: 8_000 }).toBeGreaterThan(before + 100)
    await page.mouse.up()
    const after = await firstTrack()
    expect(after).toBeGreaterThan(before + 100)

    // pointerup's own onUp handler (ResizableTable.tsx) writes the width
    // to localStorage via persist() -- a THIRD, distinct instance of the
    // same "await page.mouse.up() resolving doesn't mean the page's own
    // JS event listener has finished running" race the poll above just
    // guarded for the visual width. Waiting for the actual localStorage
    // write to land, not just assuming mouse.up()'s own resolution
    // implies it already has, is what makes the reload-persistence
    // assertion below deterministic instead of occasionally reloading
    // one tick too early and reading back the pre-drag default.
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('mill-cols-requests')), { timeout: 8_000 })
      .not.toBeNull()

    // The resized width persists across a reload (per-table localStorage,
    // reapplied by ResizableTableContainer).
    await page.reload()
    await page.getByRole('link', { name: 'Configure' }).click()
    await expect(table).toBeVisible()
    const persisted = await firstTrack()
    expect(persisted).toBeGreaterThan(before + 100)

    // Double-clicking a handle resets to default widths and clears the
    // saved state (the divider-double-click reset convention).
    await handles.first().dblclick()
    const resetWidth = await firstTrack()
    expect(resetWidth).toBeLessThan(persisted - 50)
    const savedAfterReset = await page.evaluate(() => localStorage.getItem('mill-cols-requests'))
    expect(savedAfterReset).toBeNull()

    // The URL column renders TruncatedCell: ellipsis styling plus the
    // full value available on hover via title.
    const urlCell = table.locator(`span[title="https://postman-echo.com/oauth1"]`)
    await expect(urlCell).toBeVisible()
    await expect(urlCell).toHaveCSS('text-overflow', 'ellipsis')

    // Restore row view so other specs sharing localStorage see the default.
    await page.getByRole('button', { name: 'Row view' }).click()
  })

  test('Tables fit their container by default — no horizontal overflow from long columns', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Workflows' }).click()
    // The Workflows table's Description column carries long seeded text;
    // width: 'growCollapse' + TruncatedCell must keep the grid inside
    // the container instead of forcing a horizontal scroll (the
    // reported default-layout bug).
    await page.getByRole('button', { name: 'Table view' }).click()
    const table = page.getByRole('table', { name: 'Saved workflows' })
    await expect(table).toBeVisible()
    const overflow = await table.evaluate((t) => {
      const scroller = t.parentElement as HTMLElement
      return scroller.scrollWidth - scroller.clientWidth
    })
    expect(overflow).toBeLessThanOrEqual(1)
    await page.getByRole('button', { name: 'Row view' }).click()
  })
})
