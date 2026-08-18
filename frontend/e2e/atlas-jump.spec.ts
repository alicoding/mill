import { test, expect } from './fixtures/server'

// Exercises the ⌘K jump dialog (goal 0072 slice B, AtlasJumpDialog.tsx)
// over real Go bindings (Wails3 server mode), against the same seeded
// space atlas.spec.ts's own family already proves ("My space" auto-
// entered root -> "Example area" region frame -> "Ada Lovelace"/
// "Project charter"; "Getting started"/"Scratchpad" top-level). Read-
// only against those seeds -- nothing here creates or deletes a card,
// so there's nothing to clean up (.claude/rules/testing.md).
//
// Meta+k is a real, in-window keydown here, not a stand-in for an
// OS-level hotkey (same reasoning command-palette.spec.ts's own header
// comment states for the app-wide palette). atlas.jump and palette.open
// share the same ⌘K default (shared/commands.ts, goal 0071) -- legal
// because dispatchCommandForEvent tries every command scoped to the
// ACTIVE surface before any surface-less global, so ⌘K resolves to the
// jump dialog while Atlas is mounted and to the palette everywhere
// else. AtlasJumpDialog itself is purely controlled (no capture-phase
// window listener of its own); the first test below proves the
// registry dispatch actually lands here, not just that this dialog CAN
// open some other way.

function jumpDialog(page: import('@playwright/test').Page) {
  return page.locator('[data-component="atlas-jump-dialog"]')
}

function noteCard(page: import('@playwright/test').Page, title: string) {
  return page.locator(`[data-testid="atlas-note-card"][aria-label="Open ${title}"]`)
}

function groupCard(page: import('@playwright/test').Page, title: string) {
  return page.locator('[data-testid="atlas-group-card"]').filter({ has: page.locator(`[aria-label="Zoom into ${title}"]`) })
}

test('Meta+K opens the jump dialog (registry path) over the app-wide command palette while Atlas is mounted, and opens the palette on other surfaces', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-view')).toBeVisible()

  await page.keyboard.press('Meta+k')
  await expect(jumpDialog(page)).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toHaveCount(0)

  await page.keyboard.press('Escape')
  await expect(jumpDialog(page)).toHaveCount(0)

  // Same ⌘K default, a different surface: dispatchCommandForEvent's own
  // two-pass surface precedence resolves it to the palette instead.
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.keyboard.press('Meta+k')
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible()
  await expect(jumpDialog(page)).toHaveCount(0)
  await page.keyboard.press('Escape')
})

test('typing filters the result list to the matching seeded card', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()
  await page.keyboard.press('Meta+k')
  await expect(jumpDialog(page)).toBeVisible()

  await expect(jumpDialog(page).getByTestId('atlas-jump-result')).toHaveCount(0)
  await page.getByTestId('atlas-jump-input').fill('Ada')

  const results = jumpDialog(page).getByTestId('atlas-jump-result')
  await expect(results).toHaveCount(1)
  await expect(results.first()).toContainText('Ada Lovelace')
  // Ada is a child of "Example area", one level under the auto-entered
  // root -- the row's own ancestor path names it.
  await expect(results.first()).toContainText('Example area')

  await page.keyboard.press('Escape')
})

test('Enter closes the dialog, flies to the card, pulses it and shows the open hint; a second Enter opens the overlay', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await page.keyboard.press('Meta+k')
  await page.getByTestId('atlas-jump-input').fill('Getting started')
  await expect(jumpDialog(page).getByTestId('atlas-jump-result')).toHaveCount(1)
  await page.keyboard.press('Enter')
  await expect(jumpDialog(page)).toHaveCount(0)

  const target = noteCard(page, 'Getting started')
  await expect(target).toHaveAttribute('data-pulse', 'true')
  await expect(target.getByTestId('atlas-jump-hint')).toBeVisible()

  await page.keyboard.press('Enter')
  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay).toBeVisible()
  await expect(overlay).toContainText('Getting started')
  await page.keyboard.press('Escape')
})

test('Meta+Enter jumps straight to the overlay, with no pulse/hint step', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  await page.keyboard.press('Meta+k')
  await page.getByTestId('atlas-jump-input').fill('Scratchpad')
  await expect(jumpDialog(page).getByTestId('atlas-jump-result')).toHaveCount(1)
  await page.keyboard.press('Meta+Enter')
  await expect(jumpDialog(page)).toHaveCount(0)

  const overlay = page.locator('[data-component="atlas-card-overlay"]')
  await expect(overlay).toBeVisible()
  await expect(overlay).toContainText('Scratchpad')
  await page.keyboard.press('Escape')
  await expect(overlay).toHaveCount(0)

  // No lingering pulse/hint from the immediate-open path.
  await expect(noteCard(page, 'Scratchpad').getByTestId('atlas-jump-hint')).toHaveCount(0)
})

test('jumping to a card outside the currently viewed space re-roots to its parent before the pulse', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await groupCard(page, 'Example area').getByTestId('atlas-group-header').click()
  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('Example area')

  // "Getting started" is a sibling of "Example area" (both children of
  // "My space"), not rendered on Example area's own board -- reaching
  // it must re-root to "My space" first.
  await page.keyboard.press('Meta+k')
  await page.getByTestId('atlas-jump-input').fill('Getting started')
  await expect(jumpDialog(page).getByTestId('atlas-jump-result')).toHaveCount(1)
  await page.keyboard.press('Enter')
  await expect(jumpDialog(page)).toHaveCount(0)

  await expect(page.getByTestId('atlas-breadcrumb')).toContainText('My space')
  await expect(page.getByTestId('atlas-breadcrumb')).not.toContainText('Example area')

  const target = noteCard(page, 'Getting started')
  await expect(target).toBeVisible()
  await expect(target).toHaveAttribute('data-pulse', 'true')
})

test('no matches shows the empty-result row instead of an empty list', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()
  await page.keyboard.press('Meta+k')
  await page.getByTestId('atlas-jump-input').fill('zzznomatchzzz')

  await expect(jumpDialog(page).getByTestId('atlas-jump-no-matches')).toBeVisible()
  await expect(jumpDialog(page).getByTestId('atlas-jump-result')).toHaveCount(0)

  await page.keyboard.press('Escape')
})

// Faceted search (goal 0086, shared/facetQuery.ts): vocabulary is every
// Kind's own Label + "area". "My space"/"Example area"/"Getting
// started"/"Scratchpad" are all Topic-kind (builtin.go's own seed
// comment: containment is a role, not a Kind); "Ada Lovelace" is
// Contact and "Project charter" is Document -- scoping to "Topic:"
// with empty text must list exactly the four, excluding both others.
test('"Topic: " lists every Topic-kind card, excluding other kinds', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()
  await page.keyboard.press('Meta+k')
  await expect(jumpDialog(page)).toBeVisible()

  await page.getByTestId('atlas-jump-input').fill('Topic: ')

  const results = jumpDialog(page).getByTestId('atlas-jump-result')
  await expect(results).toHaveCount(4)
  // Title-ascending, same order filterJumpCards' stableSortResults produces.
  await expect(results).toContainText(['Example area', 'Getting started', 'My space', 'Scratchpad'])
  await expect(jumpDialog(page)).not.toContainText('Ada Lovelace')
  await expect(jumpDialog(page)).not.toContainText('Project charter')

  await page.keyboard.press('Escape')
})

test('typing a Kind-label prefix offers a kind-glyph-colored suggestion chip; clicking it scopes the search', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()
  await page.keyboard.press('Meta+k')
  await expect(jumpDialog(page)).toBeVisible()

  const input = page.getByTestId('atlas-jump-input')
  await input.fill('to')

  const chip = jumpDialog(page).getByRole('button', { name: 'Topic' })
  await expect(chip).toBeVisible()
  await expect(chip.getByTestId('facet-chip-dot')).toBeVisible()

  await chip.click()
  await expect(input).toHaveValue('Topic: ')
  await expect(jumpDialog(page).getByTestId('atlas-jump-result')).toHaveCount(4)
  // The chip row is a completion aid only -- gone once a scope is active.
  await expect(jumpDialog(page).getByRole('button', { name: 'Topic' })).toHaveCount(0)

  await page.keyboard.press('Escape')
})
