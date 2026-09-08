import type { Command } from './commands'
import { entitySelectionContext } from './commandContext'
import { copy } from './copy'
import { ConfigureService } from './bindings'
import { refreshListUsage, refreshLists } from './configureEntityStore'

// The Unused-lists bulk delete (docs/goals/0392 S1, Decision 3):
// Configure's own multi-select over a page-local selection state, not
// a live board/canvas target -- entitySelection carries the checked
// ids the page itself owns (commandContext.ts's own `pinned`/`rowIDs`
// reasoning). Each id runs through the SAME ConfigureService.DeleteList
// door and undo seam a single row's own delete already does -- no
// bulk-specific RPC, no second undo mechanism.
export const CONFIGURE_LISTS_BULK_COMMANDS: Command[] = [
  {
    id: 'configure.lists.deleteUnused',
    label: 'commands.configure.lists.deleteUnusedOther',
    defaultBinding: null,
    needs: 'entitySelection',
    // Mouse-only: the target is a live checkbox selection this page
    // renders, unreachable from the palette (goal 0343's own rule for
    // a context the invoker alone can supply).
    paletteHidden: true,
    enabled: (ctx) => (entitySelectionContext(ctx, 'list')?.ids.length ?? 0) > 0,
    labelFor: (ctx) => {
      const count = entitySelectionContext(ctx, 'list')?.ids.length ?? 0
      if (count === 0) return undefined
      return copy(count === 1 ? 'commands.configure.lists.deleteUnusedOne' : 'commands.configure.lists.deleteUnusedOther', { count })
    },
    run: async (ctx) => {
      const ids = entitySelectionContext(ctx, 'list')?.ids ?? []
      for (const id of ids) {
        await ConfigureService.DeleteList(id)
      }
      void refreshLists()
      void refreshListUsage()
    },
  },
]
