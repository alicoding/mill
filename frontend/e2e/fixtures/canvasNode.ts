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
        // The drag anchor must be a point whose REAL hit-test target
        // is the pane itself -- never assumed from geometry. A fixed
        // bottom-center anchor silently landed on the MiniMap once the
        // Inspector narrowed the pane below ~2x the MiniMap's width: a
        // MiniMap drag pans INVERTED and amplified, so every chunk
        // flung the graph further away and the retry loop repeated it
        // deterministically (goal 0264's root cause -- and goal
        // 0069's "CI-only" geometry was this same collision at CI's
        // narrower pane). elementFromPoint over a candidate grid finds
        // a spot where a press really starts a pane drag; re-picked
        // per chunk since each pan slides nodes under old anchors.
        // Same occluded-drag-start class fixtures/atlasBoard.ts's
        // hittablePointOn already fixes for atlas card drags -- this
        // is that verification applied to the pane-pan press.
        // Chunked: a single drag to (anchor + d) can exceed the window
        // bounds for a far-off node, and mouse events outside the
        // window are lost -- the pan silently truncates and the node
        // stays unreachable. Cap each drag well inside the pane and
        // repeat.
        const maxChunk = Math.min(paneBox.width, paneBox.height) / 3
        let rx = dx
        let ry = dy
        for (let i = 0; i < 8 && (Math.abs(rx) > 1 || Math.abs(ry) > 1); i++) {
          const cx = Math.max(-maxChunk, Math.min(maxChunk, rx))
          const cy = Math.max(-maxChunk, Math.min(maxChunk, ry))
          const anchor = await page.evaluate(({ pane, cdx, cdy }) => {
            // Both the press point AND its drag end point must land on
            // open pane -- a drag ending on chrome is fine (only the
            // press target matters to d3-zoom), but a press on a NODE
            // would drag the node, so exclude every interactive layer.
            const fractions = [0.5, 0.35, 0.65, 0.2, 0.8]
            for (const fy of fractions) {
              for (const fx of fractions) {
                const x = pane.x + pane.width * fx
                const y = pane.y + pane.height * fy
                if (x + cdx < pane.x || x + cdx > pane.x + pane.width || y + cdy < pane.y || y + cdy > pane.y + pane.height) continue
                const el = document.elementFromPoint(x, y)
                if (el && el.classList.contains('react-flow__pane')) return { x, y }
              }
            }
            return null
          }, { pane: paneBox, cdx: cx, cdy: cy })
          if (!anchor) break
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
