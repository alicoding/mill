import { test, expect } from './fixtures/server'
import type { Page } from '@playwright/test'
import { waitForViewportStable } from './fixtures/animation'
import { workflowRow } from './fixtures/canvas'
import { wheelAt } from './fixtures/pointer'

// Canvas navigation mode (goal 0257): the scroll gesture's meaning is a
// per-device setting -- trackpad (default: scroll pans, ⌘-scroll zooms)
// vs mouse (scroll zooms). Shared worker pool: each test's fresh browser
// context starts with clean localStorage, and nothing here writes any
// global entity state -- assertions read only the board's own viewport
// transform.

async function viewportTransform(page: Page): Promise<{ x: number; y: number; scale: number }> {
  const style = await page.locator('.react-flow__viewport').first().getAttribute('style')
  const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)\s*scale\(([\d.]+)\)/.exec(style ?? '')
  if (!m) throw new Error(`viewport transform not parseable from: ${style}`)
  return { x: Number(m[1]), y: Number(m[2]), scale: Number(m[3]) }
}

async function openAtlasBoard(page: Page) {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()
  await waitForViewportStable(board)
  return board
}

test('default trackpad mode: scroll pans the board and ⌘-scroll zooms', async ({ page }) => {
  const board = await openAtlasBoard(page)

  const before = await viewportTransform(page)
  await wheelAt(page, board, 0, 200)
  await expect
    .poll(async () => {
      const t = await viewportTransform(page)
      return t.y !== before.y && t.scale === before.scale
    })
    .toBe(true)

  const mid = await viewportTransform(page)
  await page.keyboard.down('Meta')
  await wheelAt(page, board, 0, 200)
  await page.keyboard.up('Meta')
  await expect
    .poll(async () => (await viewportTransform(page)).scale)
    .not.toBe(mid.scale)
})

test('switching to Mouse in Settings makes scroll zoom the board', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Settings' }).click()
  const control = page.getByTestId('canvas-navigation-control')
  await expect(control).toBeVisible()
  await control.getByText('Mouse', { exact: true }).click()
  await expect(page.getByTestId('canvas-navigation-caption')).toHaveText('Scrolling zooms the board. Drag to pan.')

  await page.getByRole('link', { name: 'Atlas' }).click()
  const board = page.getByTestId('atlas-board')
  await expect(board).toBeVisible()
  await waitForViewportStable(board)

  const before = await viewportTransform(page)
  await wheelAt(page, board, 0, 200)
  await expect
    .poll(async () => (await viewportTransform(page)).scale)
    .not.toBe(before.scale)
})

test('the workflow canvas follows the same mode: scroll pans by default', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Workflows' }).click()
  // A seeded workflow's row click opens read-only VIEW mode -- the same
  // canvas, no entity created, nothing to clean up.
  await workflowRow(page, 'Clipboard → Markdown').click()
  const canvas = page.locator('.react-flow').first()
  await expect(canvas).toBeVisible()
  await waitForViewportStable(canvas)

  const before = await viewportTransform(page)
  await wheelAt(page, canvas, 0, 200)
  await expect
    .poll(async () => {
      const t = await viewportTransform(page)
      return t.y !== before.y && t.scale === before.scale
    })
    .toBe(true)
})
