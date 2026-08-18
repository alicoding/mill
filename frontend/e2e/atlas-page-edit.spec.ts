import { chromium, expect, test } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  ATLAS_PAGE_EDIT_MCP_BASE_PORT,
  ATLAS_PAGE_EDIT_SERVER_BASE_PORT,
  spawnMillServer,
  type SpawnedServer,
} from './fixtures/server'
import { deleteViaPageMenu } from './fixtures/atlasPage'
import { ATLAS_KIND_TOPIC, selectKind } from './fixtures/kindPicker'
import { groupCard, noteCard, openCard } from './fixtures/atlasBoard'
import { clickAtFraction } from './fixtures/animation'

// Atlas card page read-is-edit + chip navigation (goal 0081 slice A5,
// LOCKED design §5b): every field editable in place with a per-save
// tick, kind-gated Source/Mirror path, links via the page's own
// AtlasSlotRows variant, and chip-click navigation with a way back --
// driven end to end against its own dedicated server (fixtures/
// server.ts's ATLAS_PAGE_EDIT_* ports), same own-server-own-ports
// reasoning as atlas-slots.spec.ts: this spec asserts exact link/chip
// counts and nav-stack state, which the standard per-worker pool can't
// guarantee stays uncontaminated by another spec file sharing that
// worker's server.

// eslint-disable-next-line no-empty-pattern -- this test needs `testInfo` (the second arg), not any fixture.
test('atlas card page: read-is-edit fields, kind-gated mirror controls, page links, chip navigation, kebab delete', async ({}, testInfo) => {
  const idx = testInfo.parallelIndex
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-atlas-page-edit-${idx}-`))
  const settingsPath = path.join(dir, 'settings.json')
  const executionDbPath = path.join(dir, 'execution.db')
  const backupDir = path.join(dir, 'backups')
  const port = ATLAS_PAGE_EDIT_SERVER_BASE_PORT + idx
  const mcpPort = ATLAS_PAGE_EDIT_MCP_BASE_PORT + idx

  let server: SpawnedServer | undefined
  const browser = await chromium.launch()
  try {
    server = await spawnMillServer({ port, mcpPort, settingsPath, executionDbPath, backupDir })
    const page = await browser.newPage()
    await page.goto(`${server.baseURL}/`)
    await page.getByRole('link', { name: 'Atlas' }).click()
    await expect(page.getByTestId('atlas-board')).toBeVisible()

    const overlay = page.locator('[data-component="atlas-card-overlay"]')

    // --- Fresh open starts with an empty nav stack: no back button,
    // whether reached via the ordinary click-select-then-commit door
    // or (the same code path) a deep link -- AtlasView never points a
    // NEW overlayCardID at an already-open page without unmounting it
    // first, so every open is "fresh" from the page's own point of
    // view. ---
    await openCard(page, noteCard(page, 'Getting started'))
    await expect(overlay).toBeVisible()
    await expect(overlay.getByTestId('atlas-page-back')).toHaveCount(0)

    // --- Title edit in place: blur saves, a tick confirms, closing
    // and reopening shows the persisted value -- no Save button, no
    // edit-mode toggle. ---
    const titleInput = overlay.getByTestId('atlas-page-title')
    await titleInput.fill('Getting started (edited)')
    await titleInput.blur()
    await expect(overlay.getByTestId('atlas-page-saved-tick')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(overlay).not.toBeVisible()

    await openCard(page, noteCard(page, 'Getting started (edited)'))
    await expect(overlay).toBeVisible()
    await expect(overlay.getByTestId('atlas-page-title')).toHaveValue('Getting started (edited)')

    // Restore the seeded title so later assertions/cleanup in this
    // same test can keep addressing the card by its seeded name.
    await overlay.getByTestId('atlas-page-title').fill('Getting started')
    await overlay.getByTestId('atlas-page-title').blur()
    await expect(overlay.getByTestId('atlas-page-saved-tick')).toBeVisible()

    // --- Note edit round trip. ---
    const noteField = overlay.getByTestId('atlas-page-note')
    await noteField.fill('Edited by the e2e suite.')
    await noteField.blur()
    await expect(overlay.getByTestId('atlas-page-saved-tick')).toBeVisible()
    await page.keyboard.press('Escape')
    await openCard(page, noteCard(page, 'Getting started'))
    await expect(overlay.getByTestId('atlas-page-note')).toHaveValue('Edited by the e2e suite.')

    // --- Kind-gated Source/Mirror path (LOCKED design §5b): "Getting
    // started" is a plain Topic card -- neither control renders. ---
    await expect(overlay.getByTestId('atlas-page-source')).toHaveCount(0)
    await expect(overlay.getByTestId('atlas-page-mirror-path')).toHaveCount(0)
    await page.keyboard.press('Escape')

    // --- Links via the page's own slot-row Add control: "Scratchpad"
    // carries no links yet -- pick "Getting started" from the row's
    // select, Add, and the chip appears; the card's own front-face
    // links chip (the map's rendering of the same field) goes from
    // absent to "1 link". ---
    await openCard(page, noteCard(page, 'Scratchpad'))
    await expect(overlay).toBeVisible()
    const addSelect = overlay.locator('[data-testid^="atlas-slot-add-select-"]').first()
    const addButton = overlay.locator('[data-testid^="atlas-slot-add-button-"]').first()
    await addSelect.selectOption({ label: 'Getting started' })
    await addButton.click()
    const scratchpadChip = overlay.getByTestId('atlas-slot-chip').filter({ hasText: 'Getting started' })
    await expect(scratchpadChip).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(noteCard(page, 'Scratchpad').getByTestId('atlas-note-links-chip')).toHaveText('1 link')

    // Cleanup: remove the link this test added via the same chip's ×
    // (testing.md's within-file cleanup discipline).
    await openCard(page, noteCard(page, 'Scratchpad'))
    await overlay.getByTestId('atlas-slot-chip').filter({ hasText: 'Getting started' }).getByRole('button', { name: /Remove link/ }).click()
    await expect(overlay.getByTestId('atlas-slot-chip').filter({ hasText: 'Getting started' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(noteCard(page, 'Scratchpad').getByTestId('atlas-note-links-chip')).toHaveCount(0)

    // --- Chip navigation with a way back: the seed already links
    // "Getting started" -> "Ada Lovelace" ("relates to"). Opening
    // "Getting started" and clicking Ada's chip swaps the page to HER
    // card in place; a back button shows the previous card's title;
    // clicking it returns; Esc closes the whole page to the map
    // regardless of stack depth. ---
    await openCard(page, noteCard(page, 'Getting started'))
    await expect(overlay).toBeVisible()
    await overlay.getByTestId('atlas-slot-chip').filter({ hasText: 'Ada Lovelace' }).getByRole('button', { name: 'Ada Lovelace', exact: true }).click()
    await expect(overlay.getByTestId('atlas-page-title')).toHaveValue('Ada Lovelace')
    const backButton = overlay.getByTestId('atlas-page-back')
    await expect(backButton).toBeVisible()
    await expect(backButton).toHaveAttribute('aria-label', 'Back to Getting started')
    await backButton.click()
    await expect(overlay.getByTestId('atlas-page-title')).toHaveValue('Getting started')
    await expect(overlay.getByTestId('atlas-page-back')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(overlay).not.toBeVisible()

    // --- Containment-row navigation: the "Inside" child rows on a
    // container's page navigate exactly like a slot-row chip, through
    // the SAME
    // nav.navigate function (not a second copy) -- opening a
    // container's page, clicking a leaf child row, swaps to that
    // card's page with a back button naming the container. "Example
    // area" is a region frame (a group card, not a leaf note), so its
    // own page opens via a ⌘-click on the frame body (goal 0102's
    // instant-commit path), not openCard. Re-centered via Fit View
    // first: this many open/close round trips drift the board's own
    // camera enough that a card can end up clipped past the viewport
    // edge, unclickable at a fixed fraction of its own bounding box. ---
    await page.getByRole('button', { name: 'Fit View' }).click()
    const exampleAreaFrame = groupCard(page, 'Example area')
    await clickAtFraction(exampleAreaFrame, 0.01, 0.5, { modifiers: ['Meta'] })
    await expect(overlay).toBeVisible()
    const childRow = overlay.getByTestId('atlas-page-child').filter({ hasText: 'Ada Lovelace' })
    await expect(childRow).toBeVisible()
    await childRow.click()
    await expect(overlay.getByTestId('atlas-page-title')).toHaveValue('Ada Lovelace')
    const containerBack = overlay.getByTestId('atlas-page-back')
    await expect(containerBack).toBeVisible()
    await expect(containerBack).toHaveAttribute('aria-label', 'Back to Example area')
    await containerBack.click()
    await expect(overlay.getByTestId('atlas-page-title')).toHaveValue('Example area')
    await page.keyboard.press('Escape')
    await expect(overlay).not.toBeVisible()

    // --- Reveal is single-source (rider (a)): even with a real mirror
    // path set through the page's own field, the Share section never
    // shows a reveal action -- the kebab menu is the one place now,
    // and only once the card actually carries a mirror. "Project
    // charter" (Document kind, mirror-bearing) starts with a Source
    // but no MirrorPath. ---
    await groupCard(page, 'Example area').getByTestId('atlas-group-header').click()
    await openCard(page, noteCard(page, 'Project charter'))
    await expect(overlay).toBeVisible()

    // --- Actions block (goal 0084): the seeded action row renders
    // with its workflow's label, Run reports Started (the callable
    // echo is deterministic/local), remove + re-add round-trips
    // through the page and persists across reopen. ---
    const actions = overlay.getByTestId('atlas-page-actions')
    await expect(actions).toBeVisible()
    const actionRow = actions.getByTestId('atlas-page-action-row')
    await expect(actionRow).toHaveCount(1)
    await expect(actionRow).toContainText('Example: Echo message (callable child)')
    await actions.getByTestId('atlas-page-run-action').click()
    await expect(actions.getByTestId('atlas-page-action-started')).toBeVisible()
    await actionRow.getByRole('button', { name: 'Remove action' }).click()
    await expect(actionRow).toHaveCount(0)
    await actions.getByTestId('atlas-page-add-action').click()
    await actions.getByRole('combobox').selectOption({ label: 'Example: Echo message (callable child)' })
    await expect(actionRow).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(overlay).not.toBeVisible()
    await openCard(page, noteCard(page, 'Project charter'))
    await expect(overlay).toBeVisible()
    await expect(actions.getByTestId('atlas-page-action-row')).toHaveCount(1)

    await expect(overlay.getByTestId('atlas-page-source')).toBeVisible()
    await expect(overlay.getByTestId('atlas-page-mirror-path')).toBeVisible()
    await expect(overlay.getByTestId('atlas-overlay-reveal-file')).toHaveCount(0)

    // Closed by re-clicking the kebab trigger, not Escape -- Escape
    // here would also propagate to the Dialog's own close handler.
    await overlay.getByTestId('atlas-page-menu').click()
    await expect(page.getByTestId('atlas-page-menu-open-file')).toHaveCount(0)
    await expect(page.getByTestId('atlas-page-menu-reveal')).toHaveCount(0)
    await overlay.getByTestId('atlas-page-menu').click()

    const mirrorPathField = overlay.getByTestId('atlas-page-mirror-path')
    const fs = await import('node:fs')
    const os = await import('node:os')
    const mirrorDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mill-e2e-atlas-page-edit-mirror-'))
    const mirrorFile = path.join(mirrorDir, 'notes.md')
    fs.writeFileSync(mirrorFile, '# Notes')
    await mirrorPathField.fill(mirrorFile)
    await mirrorPathField.blur()
    await expect(overlay.getByTestId('atlas-page-saved-tick')).toBeVisible()
    await expect(overlay.getByTestId('atlas-overlay-reveal-file')).toHaveCount(0)

    // The kebab menu now DOES carry Open file/Reveal (page parity with
    // the canvas card menu, rider (a)). Closed by re-clicking the
    // trigger again, same reasoning as above.
    await overlay.getByTestId('atlas-page-menu').click()
    await expect(page.getByTestId('atlas-page-menu-open-file')).toBeVisible()
    await expect(page.getByTestId('atlas-page-menu-reveal')).toBeVisible()
    await overlay.getByTestId('atlas-page-menu').click()

    // Cleanup: clear the mirror path again.
    await mirrorPathField.fill('')
    await mirrorPathField.blur()
    await expect(overlay.getByTestId('atlas-page-saved-tick')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(overlay).not.toBeVisible()

    // --- Delete via the kebab menu + confirm (rider (a) supersedes
    // the old edit-section's bare Delete button): create a throwaway
    // card, delete it, confirm it's gone. ---
    await page.getByTestId('atlas-breadcrumb').getByText('My space', { exact: true }).click()
    const title = 'ZzE2eAtlasPageEditDelete'
    await page.getByTestId('atlas-add-button').click()
    await page.getByTestId('atlas-add-child').click()
    await selectKind(page, ATLAS_KIND_TOPIC, 'atlas-create-kind')
    await page.getByTestId('atlas-create-title').fill(title)
    await page.getByRole('button', { name: 'Create' }).click()
    const throwaway = noteCard(page, title)
    await expect(throwaway).toBeVisible()
    await openCard(page, throwaway)
    await expect(overlay).toBeVisible()
    await deleteViaPageMenu(page, overlay)
    await expect(overlay).not.toBeVisible()
    await expect(throwaway).not.toBeVisible()

    // --- Rider (c): AtlasCreateMenu's kind picker (its own legacy
    // native <select>) is now the shared KindPicker -- every option
    // shows its own one-line description, not just a bare name. ---
    await page.getByTestId('atlas-add-button').click()
    await page.getByTestId('atlas-add-child').click()
    await page.getByTestId('atlas-create-kind').click()
    await expect(page.getByTestId(`atlas-create-kind-option-${ATLAS_KIND_TOPIC}`)).toContainText('Something being tracked or worked through.')
    // Closed by clicking Cancel directly (registers as an outside
    // click for KindPicker's own dropdown too), not Escape -- the
    // picker's hand-rolled Escape listener doesn't stop propagation,
    // so it would also close the dialog underneath it.
    await page.getByRole('button', { name: 'Cancel' }).click()
  } finally {
    await server?.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
