import { expect, type Locator, type Page } from '@playwright/test'

// Selects a canvas node by its own stable data-id, through Playwright's
// real element click -- not a computed screen coordinate. A coordinate
// heuristic (candidate corner points + document.elementFromPoint) was
// tried first and still failed on CI both on its original attempt and
// its retry (goal 0069 take 1). Element-level `.click()` needs no
// pixel-geometry guess -- Playwright waits for the target to be
// stable/visible/unobscured and performs the browser's own real hit
// test, erroring with the exact intercepting element if something
// genuinely covers it, instead of silently landing on the wrong node --
// which is what surfaced the actual cause here: Fit View can place a
// node under one of React Flow's own fixed-corner overlays
// (CompositionCanvas.module.css's `.canvasToolbar`, top left; Controls,
// bottom left; MiniMap, bottom right), reproduced directly (not just on
// CI) once the real click reported `_canvasToolbar_*` as the
// intercepting element on every attempt.
//
// Re-running Fit View before every attempt is load-bearing, not
// cosmetic: selecting ANY node opens CanvasInspectorPanel, whose 260px
// width transition (CompositionCanvas.module.css's `.inspector`)
// permanently narrows the canvas's own flex-allocated width the first
// time it happens, so a Fit View taken before the first-ever selection
// on a workflow is not trustworthy for any selection after it. Panning
// the target node's own center onto the pane's own center afterward is
// the deterministic-arrangement half: corner-anchored chrome never
// reaches the middle of the pane regardless of node count/layout, so
// this reliably clears it before the real click is attempted, without
// guessing which corner (if any) the node landed under this time.
export async function clickCanvasNode(page: Page, panel: Locator, label: string): Promise<void> {
  const node = panel.locator('.react-flow__node').filter({ hasText: label })
  const nodeID = await node.getAttribute('data-id')
  if (!nodeID) throw new Error(`clickCanvasNode: node "${label}" has no data-id`)
  const target = panel.locator(`.react-flow__node[data-id="${nodeID}"]`)

  const viewport = panel.locator('.react-flow__viewport')
  // Fit View's pan/zoom is a d3 transition, not a synchronous update --
  // measuring a bounding box mid-transition computes a pan off stale
  // coordinates and slings the node clean out of the pane (Playwright
  // then reports "element is outside of the viewport"). A fixed sleep
  // is not enough under load; poll the viewport transform until it is
  // identical across two consecutive reads, the same stability pattern
  // resizable-table/step-detail already use.
  const waitForStableTransform = async () => {
    await expect(async () => {
      const a = await viewport.getAttribute('style')
      await new Promise((r) => setTimeout(r, 120))
      const b = await viewport.getAttribute('style')
      if (a !== b) throw new Error('viewport transform still animating')
    }).toPass({ timeout: 5_000, intervals: [120] })
  }

  await expect(async () => {
    await panel.getByRole('button', { name: 'Fit View' }).click()
    await waitForStableTransform()
    const nodeBox = await target.boundingBox()
    const paneBox = await panel.locator('.react-flow__pane').boundingBox()
    if (nodeBox && paneBox) {
      const nodeCenter = { x: nodeBox.x + nodeBox.width / 2, y: nodeBox.y + nodeBox.height / 2 }
      const paneCenter = { x: paneBox.x + paneBox.width / 2, y: paneBox.y + paneBox.height / 2 }
      const dx = paneCenter.x - nodeCenter.x
      const dy = paneCenter.y - nodeCenter.y
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        // Anchored at the pane's bottom-center, not top-center: the
        // canvas toolbar Panel spans the top-left and can reach past
        // the pane's own horizontal center, so a top-anchored drag can
        // itself start on top of it -- bottom-center clears the
        // toolbar (top) and both Controls/MiniMap (corners) alike.
        // Chunked: a single drag to (anchor + d) can exceed the window
        // bounds for a far-off node, and mouse events outside the
        // window are lost -- the pan silently truncates and the node
        // stays unreachable. Cap each drag well inside the pane and
        // repeat.
        const anchor = { x: paneBox.x + paneBox.width / 2, y: paneBox.y + paneBox.height - 20 }
        const maxChunk = Math.min(paneBox.width, paneBox.height) / 3
        let rx = dx
        let ry = dy
        for (let i = 0; i < 8 && (Math.abs(rx) > 1 || Math.abs(ry) > 1); i++) {
          const cx = Math.max(-maxChunk, Math.min(maxChunk, rx))
          const cy = Math.max(-maxChunk, Math.min(maxChunk, ry))
          await page.mouse.move(anchor.x, anchor.y)
          await page.mouse.down()
          await page.mouse.move(anchor.x + cx, anchor.y + cy, { steps: 5 })
          await page.mouse.up()
          rx -= cx
          ry -= cy
        }
        await waitForStableTransform()
      }
    }
    await target.click({ timeout: 3_000 })
    await expect(panel.locator('.react-flow__node.selected')).toHaveAttribute('data-id', nodeID)
      // CI runners under load need longer than local for the same
    // re-delivered interaction (0134's shard-1 cluster: three same-day
    // occurrences of this poll expiring on a loaded runner).
  }).toPass({ timeout: process.env.CI ? 25_000 : 10_000, intervals: [300] })
}
