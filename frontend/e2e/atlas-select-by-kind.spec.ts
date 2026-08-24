import { chromium, expect, test } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ATLAS_SELECT_KIND_MCP_BASE_PORT, ATLAS_SELECT_KIND_SERVER_BASE_PORT, spawnMillServer, type SpawnedServer } from './fixtures/server'
import { contextMenu } from './fixtures/contextMenu'
import { armAndPlaceTopicCard, dragBetween, noteCard } from './fixtures/atlasBoard'
import { ATLAS_KIND_CONTACT, ATLAS_KIND_TOPIC } from './fixtures/kindPicker'

// Dedicated server (testing.md): select-by-kind reads EVERY top-level
// card/object of a given kind -- a global board-state query the same
// class as atlas-select-group's own ⌘A test, so a concurrent shared-
// pool spec's own same-kind entity would silently inflate the count.
//
// Goal 0193's own measurement: select-by-kind rides
// BoardObject.Kind/Card.KindID, already a first-class discriminant
// (goal 0179 S1) -- the file list this spec's own PR touched to land
// the feature is the evidence for or against goal 0180's "nearly free"
// claim.
async function boardPoint(board: import('@playwright/test').Locator, fx: number, fy: number): Promise<{ x: number; y: number }> {
  const box = await board.boundingBox()
  if (!box) throw new Error('board has no bounding box')
  return { x: box.x + box.width * fx, y: box.y + box.height * fy }
}

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('select all shapes selects only the shapes, not the ink stroke alongside them', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-select-kind-${idx}-`))
  const settingsPath = path.join(dir, 'settings.json')
  const executionDbPath = path.join(dir, 'execution.db')
  const backupDir = path.join(dir, 'backups')
  const port = ATLAS_SELECT_KIND_SERVER_BASE_PORT + idx
  const mcpPort = ATLAS_SELECT_KIND_MCP_BASE_PORT + idx

  let server: SpawnedServer | undefined
  const browser = await chromium.launch()
  try {
    server = await spawnMillServer({ port, mcpPort, settingsPath, executionDbPath, backupDir })
    const page = await browser.newPage()
    await page.goto(`${server.baseURL}/`)
    await page.getByRole('link', { name: 'Atlas' }).click()
    const board = page.getByTestId('atlas-board')
    await expect(board).toBeVisible()

    const shapeTool = page.getByTestId('atlas-tray-shape')
    await shapeTool.click()
    await expect(shapeTool).toHaveAttribute('data-armed', 'true')
    await expect(page.getByTestId('atlas-shape-style-picker')).toBeVisible()
    await dragBetween(page, await boardPoint(board, 0.05, 0.1), await boardPoint(board, 0.15, 0.2))
    await dragBetween(page, await boardPoint(board, 0.25, 0.1), await boardPoint(board, 0.35, 0.2))
    await page.keyboard.press('Escape')

    const pencilTool = page.getByTestId('atlas-tray-pencil')
    await pencilTool.click()
    await expect(pencilTool).toHaveAttribute('data-armed', 'true')
    await dragBetween(page, await boardPoint(board, 0.5, 0.1), await boardPoint(board, 0.6, 0.2))
    await page.keyboard.press('Escape')

    const shapes = page.locator('[data-testid="atlas-board-object"][data-object-kind="shape"]')
    const ink = page.locator('[data-testid="atlas-board-object"][data-object-kind="ink"]')
    await expect(shapes).toHaveCount(2)
    await expect(ink).toHaveCount(1)

    // `.filter({ has })` evaluates the has-locator freshly WITHIN each
    // candidate's own subtree, so `.nth(0)`/`.first()` there means
    // "first match inside this one wrapper" (trivially true for both,
    // since each wrapper contains exactly one object) -- not "first in
    // document order". `:has()` inside the selector string itself
    // scopes correctly (Playwright evaluates it once, page-wide), so
    // `.nth()` on the resulting two-element locator addresses each
    // wrapper individually.
    const shapeWrappers = page.locator('.react-flow__node:has([data-object-kind="shape"])')
    const shapeWrapperA = shapeWrappers.nth(0)
    const shapeWrapperB = shapeWrappers.nth(1)
    const inkWrapper = page.locator('.react-flow__node:has([data-object-kind="ink"])')

    await shapes.first().click({ button: 'right' })
    const menu = contextMenu(page)
    await expect(menu).toBeVisible()
    await menu.getByText('Select all shapes', { exact: true }).click()

    await expect(shapeWrapperA).toHaveClass(/selected/)
    await expect(shapeWrapperB).toHaveClass(/selected/)
    await expect(inkWrapper).not.toHaveClass(/selected/)
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(2)

    for (let i = 0; i < 2; i++) {
      await shapes.first().click({ button: 'right' })
      await expect(menu).toBeVisible()
      await menu.getByText('Delete', { exact: true }).click()
    }
    await ink.click({ button: 'right' })
    await expect(menu).toBeVisible()
    await menu.getByText('Delete', { exact: true }).click()
    await expect(shapes).toHaveCount(0)
    await expect(ink).toHaveCount(0)
  } finally {
    await server?.stop()
    await browser.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('select all Topic cards selects only the Topic cards, not a Contact card alongside them', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-select-kind-card-${idx}-`))
  const settingsPath = path.join(dir, 'settings.json')
  const executionDbPath = path.join(dir, 'execution.db')
  const backupDir = path.join(dir, 'backups')
  const port = ATLAS_SELECT_KIND_SERVER_BASE_PORT + idx
  const mcpPort = ATLAS_SELECT_KIND_MCP_BASE_PORT + idx

  let server: SpawnedServer | undefined
  const browser = await chromium.launch()
  try {
    server = await spawnMillServer({ port, mcpPort, settingsPath, executionDbPath, backupDir })
    const page = await browser.newPage()
    await page.goto(`${server.baseURL}/`)
    await page.getByRole('link', { name: 'Atlas' }).click()
    const board = page.getByTestId('atlas-board')
    await expect(board).toBeVisible()
    const popover = page.getByTestId('atlas-placement-popover')

    await armAndPlaceTopicCard(page, board, popover, 0.05, 0.05, 'ZzKindTopicA')
    await armAndPlaceTopicCard(page, board, popover, 0.3, 0.05, 'ZzKindTopicB')

    // A Contact-kind card, placed the same instant-create way
    // armAndPlaceTopicCard uses internally, with a different
    // last-used-kind (fixtures/atlasBoard.ts's own contract).
    await page.evaluate((kindID) => localStorage.setItem('atlas.lastKindId', kindID), ATLAS_KIND_CONTACT)
    await page.keyboard.press('c')
    const box = await board.boundingBox()
    if (!box) throw new Error('board has no bounding box')
    await board.click({ position: { x: box.width * 0.55, y: box.height * 0.05 } })
    const inline = page.getByTestId('atlas-inline-title')
    await expect(inline).toBeVisible()
    await inline.fill('ZzKindContactA')
    await inline.press('Enter')
    await page.evaluate((kindID) => localStorage.setItem('atlas.lastKindId', kindID), ATLAS_KIND_TOPIC)

    const cardA = noteCard(page, 'ZzKindTopicA')
    const cardB = noteCard(page, 'ZzKindTopicB')
    const cardC = noteCard(page, 'ZzKindContactA')
    await expect(cardA).toBeVisible()
    await expect(cardB).toBeVisible()
    await expect(cardC).toBeVisible()
    const wrapperA = page.locator('.react-flow__node').filter({ has: cardA })
    const wrapperB = page.locator('.react-flow__node').filter({ has: cardB })
    const wrapperC = page.locator('.react-flow__node').filter({ has: cardC })

    await cardA.click({ button: 'right' })
    const menu = contextMenu(page)
    await expect(menu).toBeVisible()
    await menu.getByText('Select all Topic cards', { exact: true }).click()

    await expect(wrapperA).toHaveClass(/selected/)
    await expect(wrapperB).toHaveClass(/selected/)
    await expect(wrapperC).not.toHaveClass(/selected/)

    await cardA.click({ button: 'right' })
    await expect(menu).toBeVisible()
    await menu.getByText('Delete', { exact: true }).click()
    await cardB.click({ button: 'right' })
    await expect(menu).toBeVisible()
    await menu.getByText('Delete', { exact: true }).click()
    await cardC.click({ button: 'right' })
    await expect(menu).toBeVisible()
    await menu.getByText('Delete', { exact: true }).click()
    await expect(cardA).toHaveCount(0)
    await expect(cardB).toHaveCount(0)
    await expect(cardC).toHaveCount(0)
  } finally {
    await server?.stop()
    await browser.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
