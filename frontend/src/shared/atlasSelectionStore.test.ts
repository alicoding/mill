import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ambientContext } from './ambientContext'
import { atlasSelectionContext, useAtlasSelectionStore } from './atlasSelectionStore'
import { installAtlasFacts, resetAtlasFacts, type AtlasFacts } from './atlasSelectionFacts'
import { commandAvailable, commandLabel, findCommand } from './commands'
import { contextMenuItemAvailable, contextMenuItemConfirm, contextMenuItemLabel, visibleContextMenuItems } from './contextMenuItem'
import { useAppStore } from './store'

// Goal 0346 slice B: the Atlas selection is a shared context. These pin
// the properties every invoker relies on -- the palette and the keymap
// resolve it only while Atlas is the active view and something is
// selected, every selection command is honest about the SHAPE it acts
// on, and a data-driven item composes its label from the target.

const FACTS: AtlasFacts = {
  card: (id) => {
    if (id === 'c-note') return { id, title: 'A plain note', source: 'mill://c-note', mirrorPath: false, isGroup: false, projection: false, root: false, exporters: [] }
    if (id === 'c-frame') return { id, title: 'An area with a rather long title indeed', source: '', mirrorPath: true, isGroup: true, projection: false, root: true, exporters: [{ format: 'md', label: 'Markdown' }, { format: 'pdf', label: 'PDF' }] }
    return undefined
  },
  note: (id) => id === 'n-1',
  object: (id) => (id === 'o-table' ? { id, kind: 'table', rename: true, openInDefaultApp: false, editDiagram: false, fitDiagram: false, pluginItems: [{ id: 'p1', label: 'Plugin thing' }] } : undefined),
  link: (id) => (id === 'l-1' ? { id, sourceId: 'c-note', sourceTitle: 'A plain note', targetId: 'c-frame', targetTitle: 'An area', label: '' } : undefined),
  linkKinds: () => [{ id: 'lk-1', label: 'depends on' }],
  perspectives: () => [{ id: 'p-1', name: 'Roadmap', members: ['c-frame'] }],
}

const selection = (partial: Partial<{ cards: string[]; notes: string[]; objects: string[]; links: string[] }>) => ({
  spaceId: 'space', cards: [], notes: [], objects: [], links: [], ...partial,
})

describe('the ambient selection (goal 0346 slice B)', () => {
  beforeEach(() => {
    useAppStore.setState({ view: { kind: 'atlas' }, activeWorkTabKey: null, workTabs: [] })
    useAtlasSelectionStore.getState().clearSelection()
  })

  it('is the selection while Atlas is active and something is selected', () => {
    useAtlasSelectionStore.getState().setSelection(selection({ cards: ['c-note'] }))
    expect(ambientContext()).toEqual({ kind: 'selection', spaceId: 'space', cards: ['c-note'], notes: [], objects: [], links: [] })
  })

  it('falls back to the viewed card with nothing selected, and to nothing off Atlas', () => {
    useAppStore.setState({ view: { kind: 'atlas', cardID: 'c-9' } })
    expect(ambientContext()).toEqual({ kind: 'card', cardId: 'c-9' })
    useAtlasSelectionStore.getState().setSelection(selection({ notes: ['n-1'] }))
    expect(ambientContext()?.kind).toBe('selection')
    useAppStore.setState({ view: { kind: 'review' } })
    expect(ambientContext()).toBeUndefined()
  })

  it('keeps the same snapshot identity when React Flow re-reports an unchanged selection', () => {
    useAtlasSelectionStore.getState().setSelection(selection({ cards: ['c-note'], links: ['l-1'] }))
    const before = useAtlasSelectionStore.getState()
    useAtlasSelectionStore.getState().setSelection(selection({ cards: ['c-note'], links: ['l-1'] }))
    expect(useAtlasSelectionStore.getState()).toBe(before)
  })
})

describe('selection commands are honest about shape', () => {
  beforeEach(() => installAtlasFacts(FACTS))
  afterEach(() => resetAtlasFacts())

  const available = (id: string, ctx: ReturnType<typeof atlasSelectionContext> | undefined) => commandAvailable(findCommand(id)!, ctx)

  it('one-card commands refuse two cards, a note, or a card the board does not know', () => {
    expect(available('atlas.card.open', atlasSelectionContext(selection({ cards: ['c-note'] })))).toBe(true)
    expect(available('atlas.card.open', atlasSelectionContext(selection({ cards: ['c-note', 'c-frame'] })))).toBe(false)
    expect(available('atlas.card.open', atlasSelectionContext(selection({ cards: ['c-note'], notes: ['n-1'] })))).toBe(false)
    expect(available('atlas.card.open', atlasSelectionContext(selection({ cards: ['ghost'] })))).toBe(false)
    expect(available('atlas.card.open', undefined)).toBe(false)
  })

  it('group needs two placed things, delete needs one, a link action needs exactly one link', () => {
    expect(available('atlas.group.selection', atlasSelectionContext(selection({ cards: ['c-note'] })))).toBe(false)
    expect(available('atlas.group.selection', atlasSelectionContext(selection({ cards: ['c-note'], objects: ['o-table'] })))).toBe(true)
    expect(available('atlas.delete.selection', atlasSelectionContext(selection({})))).toBe(false)
    expect(available('atlas.delete.selection', atlasSelectionContext(selection({ notes: ['n-1'] })))).toBe(true)
    expect(available('atlas.link.remove', atlasSelectionContext(selection({ links: ['l-1'] })))).toBe(true)
    expect(available('atlas.link.remove', atlasSelectionContext(selection({ links: ['l-1', 'l-2'] })))).toBe(false)
  })

  it('kind-gated commands read the board facts, never a guess', () => {
    expect(available('atlas.card.zoomIn', atlasSelectionContext(selection({ cards: ['c-frame'] })))).toBe(true)
    expect(available('atlas.card.zoomIn', atlasSelectionContext(selection({ cards: ['c-note'] })))).toBe(false)
    expect(available('atlas.card.openFile', atlasSelectionContext(selection({ cards: ['c-frame'] })))).toBe(true)
    expect(available('atlas.card.fitToContent', atlasSelectionContext(selection({ cards: ['c-frame'] })))).toBe(false)
    expect(available('object.rename', atlasSelectionContext(selection({ objects: ['o-table'] })))).toBe(true)
    expect(available('diagram.fit', atlasSelectionContext(selection({ objects: ['o-table'] })))).toBe(false)
    expect(available('atlas.space.delete', atlasSelectionContext(selection({ cards: ['c-frame'] })))).toBe(true)
    expect(available('atlas.space.delete', atlasSelectionContext(selection({ cards: ['c-note'] })))).toBe(false)
  })

  it('a data-driven item is one command with the target in the context, its label composed from it', () => {
    const open = findCommand('atlas.card.open')!
    const viaLink = atlasSelectionContext(selection({ links: ['l-1'] }), { card: 'c-frame' })
    expect(commandAvailable(open, viaLink)).toBe(true)
    expect(commandLabel(open, viaLink)).toBe('Open An area with a rather long …')
    expect(commandLabel(open)).toBe('Open card')

    const add = findCommand('atlas.selection.addToPerspective')!
    const ctx = atlasSelectionContext(selection({ cards: ['c-note'] }), { perspective: 'p-1' })
    expect(commandLabel(add, ctx)).toBe('Roadmap')
    expect(commandAvailable(add, atlasSelectionContext(selection({ cards: ['c-note'] }), { perspective: 'p-9' }))).toBe(false)
    // Remove is offered only where a selected card is a member.
    const remove = findCommand('atlas.selection.removeFromPerspective')!
    expect(commandAvailable(remove, ctx)).toBe(false)
    expect(commandAvailable(remove, atlasSelectionContext(selection({ cards: ['c-frame'] }), { perspective: 'p-1' }))).toBe(true)

    const plugin = findCommand('atlas.object.pluginAction')!
    expect(commandLabel(plugin, atlasSelectionContext(selection({ objects: ['o-table'] }), { pluginItem: 'p1' }))).toBe('Plugin thing')
    expect(commandAvailable(plugin, atlasSelectionContext(selection({ objects: ['o-table'] }), { pluginItem: 'p2' }))).toBe(false)
  })

  it('the delete and add labels follow the shape they act on', () => {
    const del = findCommand('atlas.delete.selection')!
    expect(commandLabel(del, atlasSelectionContext(selection({ notes: ['n-1'] })))).toBe('Delete note')
    expect(commandLabel(del, atlasSelectionContext(selection({ cards: ['c-note'] })))).toBe('Delete')
    expect(commandLabel(del)).toBe('Delete selection')
    const add = findCommand('atlas.board.addCard')!
    expect(commandLabel(add, atlasSelectionContext(selection({ cards: ['c-frame'] })))).toBe('Add card to An area with a rather long title indeed')
    expect(commandLabel(add, atlasSelectionContext(selection({})))).toBe('Add card')
    expect(commandAvailable(add, atlasSelectionContext(selection({ cards: ['c-note'] })))).toBe(false)
  })

  it('a menu drops a submenu head with nothing under it, and asks the command own question', () => {
    const rows = [{ id: 'r1', commandId: 'atlas.link.setKind', ctx: atlasSelectionContext(selection({ links: ['l-1', 'l-2'] }), { linkKind: 'lk-1' }) }]
    expect(visibleContextMenuItems([{ id: 'head', label: 'Change link kind', submenu: rows }])).toEqual([])
    const live = [{ id: 'r1', commandId: 'atlas.link.setKind', ctx: atlasSelectionContext(selection({ links: ['l-1'] }), { linkKind: 'lk-1' }) }]
    expect(contextMenuItemAvailable({ id: 'head', label: 'Change link kind', submenu: live })).toBe(true)
    expect(contextMenuItemLabel(live[0])).toBe('depends on')
    expect(contextMenuItemConfirm({ id: 'x', commandId: 'atlas.link.remove', ctx: live[0].ctx })).toBeNull()
    expect(contextMenuItemConfirm({ id: 'y', commandId: 'atlas.link.remove', ctx: live[0].ctx, confirm: { title: 'T', body: 'B' } })).toEqual({ title: 'T', body: 'B' })
  })
})
