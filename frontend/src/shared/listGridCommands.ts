import type { Command } from './commands'
import { listGridContext } from './commandContext'
import { ConfigureService } from './bindings'
import { writeClipboardText } from './clipboardWrite'

// The grid's bulk actions (goal 0349 S4). A row-marker checkbox
// selection or a selected column header is a live target the registry
// cannot see, so the grid's toolbar states it as the command's context
// (goal 0343) -- the same shape ROW_COMMANDS uses. Every one of them
// declares `needs`, so none can fire without that target.

// Deleting rows is sequential, never concurrent: each DeleteListRow
// rewrites the record it re-read, so parallel calls would race each
// other's read-modify-write and lose deletions.
async function deleteRows(listID: string, rowIDs: string[]): Promise<void> {
  for (const rowID of rowIDs) {
    await ConfigureService.DeleteListRow(listID, rowID)
  }
}

export const LIST_GRID_COMMANDS: Command[] = [
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
]
