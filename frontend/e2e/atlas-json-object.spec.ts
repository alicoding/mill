import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { test, expect } from './fixtures/server'
import { createBoardObjectViaRPC, ATLAS_DEFAULT_SPACE_ID } from './fixtures/atlasNativeDropEscapeHatch'
import { nonSeededBoardObjects } from './fixtures/atlasBoard'
import { clickAtFraction, waitForViewportStable } from './fixtures/animation'

// The "json" board object (goal 0269): a dropped .json/.yaml/.yml file
// lands as a collapsible TREE on the board -- counts on a collapsed
// container, a filter over keys and values, the three row copies, and
// the file itself as the source of truth. The routing DECISION (which
// extensions count) is Vitest-tested directly (jsonTree.test.ts's
// isJsonPath), the same scope split atlas-sheet-object.spec.ts's own
// header documents; the native OS drop gesture has no reachable user
// primitive in this harness, so every test lands its object through the
// same CreateBoardObject RPC escape hatch and proves the RESULT.
//
// Shared worker pool: every assertion is scoped to the one object the
// test creates and deletes itself (nonSeededBoardObjects excludes the
// seeded gallery examples), and each test writes its own fixture file
// into its own mkdtemp directory.

// atlas-sheet-object.spec.ts's own proven-safe coordinate: far enough
// below the seeded card row that fit-to-view never tucks the object
// under the fixed sidebar or the creation tray.
const SAFE_POS = { X: 0, Y: 480 }

const SAMPLE = {
  client: 'Northwind Trading',
  sponsor: 'Jordan Reyes',
  active: true,
  closedOn: null,
  workstreams: [
    { name: 'Discovery', owner: 'Priya Nair' },
    { name: 'Migration', owner: 'Sam Okafor' },
  ],
  budget: {
    currency: 'GBP',
    approved: 480000,
    contingency: { approved: 48000, notes: { reason: 'scope change' } },
  },
}

const SAMPLE_YAML = `client: Northwind Trading
sponsor: Jordan Reyes
defaults: &d
  owner: Unassigned
workstreams:
  - name: Discovery
    owner: Priya Nair
  - name: Handover
    <<: *d
budget:
  currency: GBP
  approved: 480000
`

function jsonObjects(page: import('@playwright/test').Page) {
  return nonSeededBoardObjects(page, 'json')
}

function tempFile(prefix: string, name: string, content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  const file = path.join(dir, name)
  fs.writeFileSync(file, content)
  return file
}

// A tree row's OWN line, excluding the subtree it contains: a
// TreeView item's <li> wraps its whole subtree, so a click at the li's
// center lands on a descendant row, and the innermost row's own
// handlers answer instead.
function row(tree: import('@playwright/test').Locator, path: string) {
  return tree.locator(`[data-path="${path}"] > .PRIVATE_TreeView-item-container`)
}

// Deletes every non-seeded "json" object on the default space through
// the same low-level RPC channel createBoardObjectViaRPC uses. Run
// before each landing rather than trusting the previous test's own
// cleanup: a failed test (and Playwright's own retry of it) leaves its
// object behind, and the next test's kind-scoped locator would then
// resolve to two nodes.
async function clearJsonObjects(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(async () => {
    const call = async (methodName: string, args: unknown[]) => {
      const callID = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const res = await fetch(window.location.origin + '/wails/runtime', {
        method: 'POST',
        headers: { 'x-wails-client-id': 'e2e-json-cleanup', 'Content-Type': 'application/json' },
        body: JSON.stringify({ object: 0, method: 0, args: { 'call-id': callID, methodName, args } }),
      })
      if (!res.ok) throw new Error(`${methodName} failed: ${res.status} ${await res.text()}`)
      return res.json()
    }
    const result = await call('github.com/alicoding/mill/internal/services/atlassvc.AtlasService.Objects', [])
    const objects = (result ?? []) as { ID: string; Kind: string }[]
    for (const o of objects) {
      if (o.Kind === 'json' && !o.ID.startsWith('atlas-object-example-')) {
        await call('github.com/alicoding/mill/internal/services/atlassvc.AtlasService.DeleteBoardObject', [o.ID])
      }
    }
  })
}

async function openBoard(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()
}

// Lands the object, reloads so the board reads it back from the server,
// and lifts the click shield -- the face is inert until the object is
// selected (the clickShield contract), which is what a user does first
// too.
async function landAndSelect(page: import('@playwright/test').Page, file: string) {
  await openBoard(page)
  await clearJsonObjects(page)
  await createBoardObjectViaRPC(page, 'json', { mirrorPath: file }, SAFE_POS, ATLAS_DEFAULT_SPACE_ID)
  await page.reload()
  await openBoard(page)
  const object = jsonObjects(page)
  await expect(object).toBeVisible()
  // Wait for the face to reach a settled state before clicking: the
  // mirror read and the parse both resolve after mount, and each one
  // rebuilds the board's nodes -- a selecting click that lands mid
  // rebuild is dropped with the node it landed on.
  const settled = '[data-testid="atlas-object-json-tree"], [data-testid="atlas-object-json-parse-error"], [data-testid="atlas-object-json-empty"], [data-testid="atlas-object-json-unreadable"], [data-testid="atlas-object-json-error"]'
  // Generous: the first mirror read of a worker's run pays the server's
  // own cold start on top of the read itself.
  await expect(object.locator(settled)).toHaveCount(1, { timeout: 20_000 })
  await waitForViewportStable(page.getByTestId('atlas-board'))
  const shield = object.locator('[data-testid="atlas-object-click-shield"]')
  // Clicking the shield is what a user does to make the face live. The
  // object can also already be selected when the board settles, and
  // then there is no shield to click -- what every test below needs is
  // the END state (a live face), not the click that got there.
  // Off-centre on purpose: fit-to-view can leave the object's own
  // centre point under the fixed left sidebar, which intercepts the
  // click; its trailing edge is always over open canvas.
  if (await shield.count()) await clickAtFraction(shield, 0.85, 0.5)
  await expect(shield).toHaveCount(0)
  return object
}

// The OBJECT's menu opens off its chrome band, never its body: a tree
// row owns right-clicks over the face (that is the row menu this file
// also tests), so the band is the one surface that answers with the
// object's own menu -- fixtures/atlasBoard.ts states the same rule for
// every grid-hosting kind.
async function deleteViaContextMenu(page: import('@playwright/test').Page, object: import('@playwright/test').Locator) {
  await waitForViewportStable(page.getByTestId('atlas-board'))
  await object.locator('[data-testid="atlas-board-object-frame"]').click({ button: 'right' })
  const menu = page.getByTestId('context-menu')
  await expect(menu).toBeVisible()
  await menu.getByText('Delete', { exact: true }).click()
}

test('a dropped .json file renders as a tree: depth-2 on arrival, counts on what stays closed', async ({ page }) => {
  const file = tempFile('mill-e2e-atlas-json-', 'ZzE2eJsonTree.json', JSON.stringify(SAMPLE, null, 2))
  const object = await landAndSelect(page, file)
  const tree = object.getByTestId('atlas-object-json-tree')
  await expect(tree).toBeVisible()

  // Type by rendering, no badges: each primitive row carries its own
  // kind, and a string keeps its quotes so "480000" and 480000 could
  // never read alike.
  const sponsor = tree.locator('[data-path="sponsor"]')
  await expect(sponsor).toContainText('"Jordan Reyes"')
  await expect(sponsor).toHaveAttribute('data-value-kind', 'string')
  await expect(tree.locator('[data-path="active"]')).toHaveAttribute('data-value-kind', 'boolean')
  await expect(tree.locator('[data-path="closedOn"]')).toHaveAttribute('data-value-kind', 'null')
  await expect(tree.locator('[data-path="budget.approved"]')).toHaveAttribute('data-value-kind', 'number')

  // Depth 2: the root's own members and THEIR members are open, so a
  // level-2 row is on screen; a level-3 container is closed and says
  // how much it holds instead.
  await expect(tree.locator('[data-path="workstreams[0].owner"]')).toContainText('"Priya Nair"')
  const notes = tree.locator('[data-path="budget.contingency.notes"]')
  await expect(notes).toHaveAttribute('aria-expanded', 'false')
  await expect(row(tree, 'budget.contingency.notes')).toContainText('{1}')
  await expect(tree.locator('[data-path="budget.contingency.notes.reason"]')).toHaveCount(0)
  // An open container hides nothing, so it shows no count at all.
  await expect(row(tree, 'workstreams')).not.toContainText('[2]')

  await deleteViaContextMenu(page, object)
  await expect(jsonObjects(page)).toHaveCount(0)
})

test('a row\'s own chevron opens and closes just that row', async ({ page }) => {
  const file = tempFile('mill-e2e-atlas-json-chevron-', 'ZzE2eJsonChevron.json', JSON.stringify(SAMPLE, null, 2))
  const object = await landAndSelect(page, file)
  const tree = object.getByTestId('atlas-object-json-tree')
  const notes = tree.locator('[data-path="budget.contingency.notes"]')

  await row(tree, 'budget.contingency.notes').locator('.PRIVATE_TreeView-item-toggle').click()
  await expect(notes).toHaveAttribute('aria-expanded', 'true')
  await expect(tree.locator('[data-path="budget.contingency.notes.reason"]')).toContainText('"scope change"')

  await row(tree, 'budget.contingency.notes').locator('.PRIVATE_TreeView-item-toggle').click()
  await expect(notes).toHaveAttribute('aria-expanded', 'false')
  await expect(tree.locator('[data-path="budget.contingency.notes.reason"]')).toHaveCount(0)

  await deleteViaContextMenu(page, object)
  await expect(jsonObjects(page)).toHaveCount(0)
})

test('Collapse all closes every container and Expand all opens every one', async ({ page }) => {
  const file = tempFile('mill-e2e-atlas-json-bulk-', 'ZzE2eJsonBulk.json', JSON.stringify(SAMPLE, null, 2))
  const object = await landAndSelect(page, file)
  const tree = object.getByTestId('atlas-object-json-tree')

  await object.getByTestId('atlas-object-json-collapse-all').click()
  await expect(tree.locator('[data-path="workstreams"]')).toHaveAttribute('aria-expanded', 'false')
  await expect(row(tree, 'workstreams')).toContainText('[2]')
  await expect(tree.locator('[data-path="workstreams[0]"]')).toHaveCount(0)

  await object.getByTestId('atlas-object-json-expand-all').click()
  await expect(tree.locator('[data-path="budget.contingency.notes"]')).toHaveAttribute('aria-expanded', 'true')
  await expect(tree.locator('[data-path="budget.contingency.notes.reason"]')).toContainText('"scope change"')

  await deleteViaContextMenu(page, object)
  await expect(jsonObjects(page)).toHaveCount(0)
})

test('the filter counts its matches and opens whatever hid one', async ({ page }) => {
  const file = tempFile('mill-e2e-atlas-json-filter-', 'ZzE2eJsonFilter.json', JSON.stringify(SAMPLE, null, 2))
  const object = await landAndSelect(page, file)
  const tree = object.getByTestId('atlas-object-json-tree')
  const filter = object.getByTestId('atlas-object-json-filter')

  // A row three levels down, inside a container that arrived closed.
  await filter.fill('scope change') // fill: a form control; per-keystroke typing drops characters under CI load (goal 0296)
  await expect(object.getByTestId('atlas-object-json-matches')).toHaveText('1 match')
  await expect(tree.locator('[data-path="budget.contingency.notes.reason"]')).toBeVisible()

  await filter.fill('owner') // fill: a form control (goal 0296)
  await expect(object.getByTestId('atlas-object-json-matches')).toHaveText('2 matches')
  // A filter NARROWS: a row that neither matches nor holds a match is
  // gone, not merely un-highlighted.
  await expect(tree.locator('[data-path="workstreams[0].owner"]')).toBeVisible()
  await expect(tree.locator('[data-path="client"]')).toHaveCount(0)
  await expect(tree.locator('[data-path="budget"]')).toHaveCount(0)

  await filter.fill('nothing here') // fill: a form control (goal 0296)
  await expect(object.getByTestId('atlas-object-json-matches')).toHaveText('No matches')

  // Clearing the box restores the arrival expansion: the deep row is
  // hidden again, the level-2 rows are still open.
  await filter.fill('') // fill: a form control (goal 0296)
  await expect(object.getByTestId('atlas-object-json-matches')).toHaveCount(0)
  await expect(tree.locator('[data-path="budget.contingency.notes.reason"]')).toHaveCount(0)
  await expect(tree.locator('[data-path="workstreams[0].owner"]')).toBeVisible()

  await deleteViaContextMenu(page, object)
  await expect(jsonObjects(page)).toHaveCount(0)
})

test('a row\'s menu copies its path, its key and its value', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  const file = tempFile('mill-e2e-atlas-json-copy-', 'ZzE2eJsonCopy.json', JSON.stringify(SAMPLE, null, 2))
  const object = await landAndSelect(page, file)
  const tree = object.getByTestId('atlas-object-json-tree')
  const clipboard = () => page.evaluate(() => navigator.clipboard.readText())

  const owner = tree.locator('[data-path="workstreams[0].owner"]')
  await owner.click({ button: 'right' })
  const menu = page.getByTestId('context-menu')
  await expect(menu).toBeVisible()
  await menu.getByText('Copy path', { exact: true }).click()
  // The browser-inspector convention: dots for identifier keys,
  // brackets for an index, and no root token at all.
  await expect.poll(clipboard).toBe('workstreams[0].owner')

  await owner.click({ button: 'right' })
  await expect(menu).toBeVisible()
  await menu.getByText('Copy key', { exact: true }).click()
  await expect.poll(clipboard).toBe('owner')

  // A container copies its whole subtree as pretty-printed JSON.
  await row(tree, 'workstreams[0]').click({ button: 'right' })
  await expect(menu).toBeVisible()
  await menu.getByText('Copy value', { exact: true }).click()
  await expect.poll(clipboard).toBe(JSON.stringify(SAMPLE.workstreams[0], null, 2))

  await deleteViaContextMenu(page, object)
  await expect(jsonObjects(page)).toHaveCount(0)
})

test('the tree follows the file: an edit on disk lands without a reload or a click', async ({ page }) => {
  const file = tempFile('mill-e2e-atlas-json-live-', 'ZzE2eJsonLive.json', JSON.stringify(SAMPLE, null, 2))
  const object = await landAndSelect(page, file)
  const tree = object.getByTestId('atlas-object-json-tree')
  await expect(tree.locator('[data-path="sponsor"]')).toContainText('"Jordan Reyes"')

  // The external edit an editor or a script would make.
  fs.writeFileSync(file, JSON.stringify({ ...SAMPLE, sponsor: 'Alex Mercer' }, null, 2))

  // fsnotify plus the write debounce make this genuinely timing-bound.
  await expect(tree.locator('[data-path="sponsor"]')).toContainText('"Alex Mercer"', { timeout: 10_000 })
  // The expansion survived the re-parse: every path still present keeps
  // whatever it had open.
  await expect(tree.locator('[data-path="workstreams[0].owner"]')).toBeVisible()

  await deleteViaContextMenu(page, object)
  await expect(jsonObjects(page)).toHaveCount(0)
})

test('a .yaml file renders the same tree, with anchors resolved and comments gone', async ({ page }) => {
  const file = tempFile('mill-e2e-atlas-json-yaml-', 'ZzE2eJsonYaml.yaml', `# a comment\n${SAMPLE_YAML}`)
  const object = await landAndSelect(page, file)
  const tree = object.getByTestId('atlas-object-json-tree')

  await expect(tree.locator('[data-path="client"]')).toContainText('"Northwind Trading"')
  // The merge key resolved into the row rather than showing itself.
  await expect(tree.locator('[data-path="workstreams[1].owner"]')).toContainText('"Unassigned"')
  await expect(tree.locator('[data-path="workstreams[1][\\"<<\\"]"]')).toHaveCount(0)

  await deleteViaContextMenu(page, object)
  await expect(jsonObjects(page)).toHaveCount(0)
})

test('a file that will not parse says so, names where it failed, and offers the app that can fix it', async ({ page }) => {
  const file = tempFile('mill-e2e-atlas-json-broken-', 'ZzE2eJsonBroken.json', '{\n  "a": 1,\n  "b" 2\n}\n')
  const object = await landAndSelect(page, file)

  const failure = object.getByTestId('atlas-object-json-parse-error')
  await expect(failure).toBeVisible()
  await expect(failure).toContainText("Can't read this file as JSON.")
  await expect(object.getByTestId('atlas-object-json-parse-detail')).toContainText('3:')
  // An empty state offers the action it names.
  await expect(object.getByTestId('atlas-object-json-open-in-default-app')).toBeVisible()
  await expect(object.getByTestId('atlas-object-json-tree')).toHaveCount(0)

  await deleteViaContextMenu(page, object)
  await expect(jsonObjects(page)).toHaveCount(0)
})

test('an empty file says it is empty and offers the app that can fill it', async ({ page }) => {
  const file = tempFile('mill-e2e-atlas-json-empty-', 'ZzE2eJsonEmpty.json', '')
  const object = await landAndSelect(page, file)

  const empty = object.getByTestId('atlas-object-json-empty')
  await expect(empty).toBeVisible()
  await expect(empty).toContainText('This file is empty.')
  await expect(object.getByTestId('atlas-object-json-open-in-default-app')).toBeVisible()

  await deleteViaContextMenu(page, object)
  await expect(jsonObjects(page)).toHaveCount(0)
})

test('a json board object offers "Open in default app"', async ({ page }) => {
  const file = tempFile('mill-e2e-atlas-json-open-', 'ZzE2eJsonOpen.json', JSON.stringify(SAMPLE, null, 2))
  const object = await landAndSelect(page, file)
  await object.locator('[data-testid="atlas-board-object-frame"]').click({ button: 'right' })
  const menu = page.getByTestId('context-menu')
  await expect(menu).toBeVisible()
  const openInDefaultApp = menu.getByText('Open in default app', { exact: true })
  await expect(openInDefaultApp).toBeVisible()
  // Headless/server mode has no live desktop app to launch -- the RPC
  // still resolves, proving the item is wired to the real command
  // rather than a dead click.
  await openInDefaultApp.click()
  await expect(menu).not.toBeVisible()

  await deleteViaContextMenu(page, object)
  await expect(jsonObjects(page)).toHaveCount(0)
})
