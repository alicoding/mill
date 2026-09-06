import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { trackpadWheelAt } from './pointer'
import { waitForViewportStable } from './animation'

// The selected half of the one activation contract (goal 0354),
// asserted identically wherever a spec reaches it: a live face owns the
// wheel OUTRIGHT, so a trackpad burst over it never also moves the
// board, while the chrome band beside it -- frame, not face -- is left
// to the canvas. Promoted here because the built-in nouns, the frame
// preview and a runtime plugin's face all have to hold to it.
//
// The band's half is asserted through the canvas kit's OWN rule --
// `event.target.closest('.nowheel')`, which is exactly how it decides
// whether to stand down -- rather than by panning the board: the band
// is 14 CSS px tall and travels with the pan, so a burst aimed at it
// walks off it after the first event and leaves the board somewhere
// this helper cannot put back. The behavioural half (a wheel over the
// band really pans the board) lives in atlas-node-input-contract.spec.ts,
// which re-reveals the object afterwards.
export async function expectSelectedFaceOwnsWheel(page: Page, object: Locator): Promise<void> {
  const face = object.getByTestId('atlas-board-object-face')
  const band = object.getByTestId('atlas-board-object-frame')
  await expect(face).toHaveClass(/nowheel/)
  await expect(object).not.toHaveClass(/nowheel/)
  expect(await band.evaluate((el) => el.closest('.nowheel') === null)).toBe(true)
  const boardTransform = () => page.locator('.react-flow__viewport').evaluate((el) => el.style.transform)
  await waitForViewportStable(page.getByTestId('atlas-board'))
  const settled = await boardTransform()
  await trackpadWheelAt(page, face, 'top', 1)
  await page.waitForTimeout(300) // no observable "wheel fully routed" signal exists for a negative assertion
  expect(await boardTransform()).toBe(settled)
}
