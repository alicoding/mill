import type { Command } from './commands'
import { listGridContext } from './commandContext'
import { AtlasService, ConfigureService } from './bindings'
import { writeClipboardText } from './clipboardWrite'
import { focusedListGridSearch } from './listGridSearchFocus'

// The grid's bulk actions (goal 0349 S4). A row-marker checkbox
// selection or a selected column header is a live target the registry
// cannot see, so the grid's toolbar states it as the command's context
// (goal 0343) -- the same shape ROW_COMMANDS uses. Every one of them
// declares `needs`, so none can fire without that target.

// Deleting rows is sequential, never concurrent: each DeleteListRow
// rewrites the record it re-read, so parallel calls would race each
// other's read-modify-write and lose deletions. One gesture is one ⌘Z
// step: every delete made between BeginUndoMark and EndUndoMark joins
// a single mark (ADR-0044), so a bulk delete undoes as a bulk restore
// rather than one row per press (goal 0352).
async function deleteRows(listID: string, rowIDs: string[]): Promise<void> {
  await AtlasService.BeginUndoMark()
  try {
    for (const rowID of rowIDs) {
      await ConfigureService.DeleteListRow(listID, rowID)
    }
  } finally {
    await AtlasService.EndUndoMark()
  }
}

export const LIST_GRID_COMMANDS: Command[] = [
  {
    // The grid's own search (goal 0349 S4 gap): opens/closes on ⌘F
    // while a grid holds focus, alongside the list's own toolbar
    // search box (which filters rows) rather than replacing it -- this
    // one highlights matches within the shown rows without narrowing
    // them. hintOnly: the real ⌘F detection lives in ListGridGlide's
    // own keydown handler, never dispatchCommandForEvent -- every
    // keystroke in the grid is stopped from ever reaching the window
    // dispatcher (same reason the other three commands here are
    // invoked directly, with an explicit context, rather than reached
    // by a binding). defaultBinding still drives HotkeyHint/Shortcuts
    // Help; ListGridGlide's own handler is what actually calls
    // runCommand.
    id: 'listGrid.search',
    label: 'commands.listGrid.search',
    defaultBinding: { mods: ['cmd'], key: 'F' },
    hintOnly: true,
    needs: 'listGrid',
    enabled: (ctx) => listGridContext(ctx) !== null && focusedListGridSearch() !== null,
    run: () => focusedListGridSearch()?.toggleSearch(),
  },
  {
    id: 'listGrid.deleteRows',
    label: 'commands.listGrid.deleteRows',
    defaultBinding: null,
    needs: 'listGrid',
    enabled: (ctx) => (listGridContext(ctx)?.rowIDs.length ?? 0) > 0,
    run: (ctx) => {
      const target = listGridContext(ctx)
      if (!target || target.rowIDs.length === 0) return
      return deleteRows(target.listID, target.rowIDs)
    },
  },
  {
    id: 'listGrid.copyRows',
    label: 'commands.listGrid.copyRows',
    defaultBinding: null,
    needs: 'listGrid',
    // The grid states the tab/newline text itself: only it knows which
    // columns are showing and in what order.
    enabled: (ctx) => (listGridContext(ctx)?.text ?? '') !== '',
    run: (ctx) => {
      const text = listGridContext(ctx)?.text ?? ''
      if (text === '') return
      return writeClipboardText(text)
    },
  },
  {
    id: 'listGrid.deleteColumn',
    label: 'commands.listGrid.deleteColumn',
    defaultBinding: null,
    needs: 'listGrid',
    enabled: (ctx) => (listGridContext(ctx)?.columnKey ?? '') !== '',
    run: async (ctx) => {
      const target = listGridContext(ctx)
      if (!target?.columnKey) return
      const list = await ConfigureService.GetList(target.listID)
      const removed = (list.Columns ?? []).find((c) => c.Key === target.columnKey)
      if (!removed) return
      const kept = (list.Columns ?? []).filter((c) => c.Key !== target.columnKey)
      await ConfigureService.UpdateList(list.ID, list.Label, list.Description, kept, [{ Key: removed.Key, Type: removed.Type }])
    },
  },
  {
    // The grid's own row placements (goal 0349 S4 Part B): Glide's
    // trailing row, wherever a mount paints it. Stateless -- appending
    // a row is a plain door call, always at the list's own end,
    // regardless of which mount's trailing row was clicked.
    id: 'listGrid.addRow',
    label: 'commands.listGrid.addRow',
    defaultBinding: null,
    needs: 'listGrid',
    enabled: (ctx) => listGridContext(ctx) !== null,
    run: async (ctx) => {
      const target = listGridContext(ctx)
      if (!target) return
      await ConfigureService.AddListRowAt(target.listID, {}, -1)
    },
  },
  {
    // The header-end "+" (rightElement) and the empty state's own add-
    // column button. Unlike addRow, this reaches into the FOCUSED
    // mount's own insertColumn (listGridSearchFocus.ts): only that
    // mount's local state can open the new column's rename field the
    // way its own header-menu insert already does.
    id: 'listGrid.addColumn',
    label: 'commands.listGrid.addColumn',
    defaultBinding: null,
    needs: 'listGrid',
    enabled: (ctx) => listGridContext(ctx) !== null && focusedListGridSearch() !== null,
    run: () => focusedListGridSearch()?.insertColumn(),
  },
]
