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
    // Real OS-level page.mouse.move/down/up synthesizes actual
    // mousemove/mouseup input via CDP, which under CPU contention (4
    // parallel workers, each a full browser) can have individual
    // pointermove dispatches genuinely lost in the browser's own input
    // pipeline before the renderer's main thread gets to them -- not a
    // delay a longer poll or an animation-frame yield can recover from,
    // since a dropped event never arrives at all (confirmed: neither a
    // per-step `expect.poll` nor a `requestAnimationFrame` round-trip
    // between moves made this deterministic under load). Driving the
    // drag via PointerEvents dispatched directly on the handle removes
    // the OS/CDP input pipeline from the equation entirely -- it still
    // exercises ResizableTable.tsx's real onPointerDown/onMove/onUp
    // listeners (the actual code under test), just via synchronous
    // in-page dispatch instead of hardware-level simulation, so no
    // event can be silently coalesced away before it reaches them.
    // pointerdown + every pointermove dispatch inside ONE evaluate call
    // (one synchronous in-page execution, not N separate round-trips) --
    // JS's single-threaded run-to-completion guarantee is what makes
    // this deterministic: nothing else can interleave between two
    // dispatchEvent calls in the same synchronous callback, unlike N
    // separately-awaited Playwright commands each of which yields back
    // to Node (and can be delayed there) between steps.
    const pointerId = 1
    const dragSteps = 6
    await handles.first().evaluate((el, { startX, startY, dx, steps, pointerId: pid }) => {
      el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: pid, clientX: startX, clientY: startY, bubbles: true, cancelable: true }))
      for (let i = 1; i <= steps; i++) {
        el.dispatchEvent(new PointerEvent('pointermove', { pointerId: pid, clientX: startX + (dx * i) / steps, clientY: startY, bubbles: true, cancelable: true }))
      }
    }, { startX: x, startY: y, dx: 120, steps: dragSteps, pointerId })
    const midDrag = await firstTrack()
    expect(midDrag).toBeGreaterThan(before + 100)
    await handles.first().evaluate((el, pid) => {
      el.dispatchEvent(new PointerEvent('pointerup', { pointerId: pid, bubbles: true, cancelable: true }))
    }, pointerId)
    const after = await firstTrack()
    expect(after).toBeGreaterThan(before + 100)

    // pointerup's own onUp handler (ResizableTable.tsx) writes the width
    // to localStorage via persist(), synchronously within the dispatched
    // event above -- already landed by construction. Polled rather than
    // asserted directly anyway, so a future async persist() path stays
    // covered without silently going stale.
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
