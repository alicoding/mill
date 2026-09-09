import { AtlasService } from './bindings'
import { copy } from './copy'
import { findCommand } from './commands'
import { useUndoDeleteStore } from './undoDeleteStore'

// The bulk delete door every list surface's Delete goes through (goal
// 0404 S1's Divergences: "stop at the first refused item" is the
// obvious shape; here every item is tried and a refusal is reported by
// name, never silently skipped or aborted mid-loop). One
// BeginUndoMark/EndUndoMark wrap (the listGridCommands.ts pattern)
// around each item's own existing delete door: every Configure kind's
// door already registers itself into the app's one actor-scoped
// journal (ADR-0044) on every call, so wrapping N of them in one open
// mark joins them into ONE entry -- no new undo mechanism, no new
// server-side RPC.

export interface BulkDeleteItem {
  id: string
  label: string
}

export interface BulkDeleteOutcome {
  deleted: string[]
  kept: BulkDeleteItem[]
}

// Up to this many kept names are spelled out before the toast falls
// back to "and N more" (Decision 4).
const MAX_NAMED_KEPT = 3

// Plain comma-join with a final "and" for the fully-named case
// ("Alpha, Beta, and Gamma") -- a truncated list leaves the "and" for
// the trailing "and N more" instead ("Alpha, Beta, and 2 more" would
// otherwise read as two conjunctions fighting each other).
function joinWithAnd(names: string[]): string {
  if (names.length <= 1) return names.join('')
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

function formatKeptNames(kept: BulkDeleteItem[]): string {
  const shown = kept.slice(0, MAX_NAMED_KEPT).map((k) => k.label)
  const remaining = kept.length - shown.length
  if (remaining <= 0) return joinWithAnd(shown)
  return `${shown.join(', ')}, ${copy('bulkDelete.andMore', { count: remaining })}`
}

function outcomeMessage(entity: string, deletedCount: number, kept: BulkDeleteItem[]): string {
  const plurality = deletedCount === 1 ? 'one' : 'other'
  const kind = copy(`bulkDelete.kindLabel.${entity}.${plurality}`)
  if (kept.length === 0) return copy('bulkDelete.deleted', { count: deletedCount, kind })
  return copy('bulkDelete.deletedKeptNamed', { deleted: deletedCount, kind, kept: kept.length, names: formatKeptNames(kept) })
}

// bulkDeleteWithUndo runs `remove` over every item, continuing past a
// refusal (a referenced entity the backend's own precheck blocks) so
// one locked item never strands the rest of the selection undeleted.
// `journal` names the ADR-0044 entry family/id the LAST successfully
// deleted item registered under -- what the posted toast watches to
// know its Undo is still the journal's own top step (the same
// affordance-over-journal contract shared/deleteWithUndo.ts already
// keeps for a single row, goal 0352 part 2). Pass `journal: null` for
// a door that registers no way back (Secrets, goal 0404 S1's
// amendment): the toast still reports the outcome, with no Undo
// button.
export async function bulkDeleteWithUndo({ entity, items, remove, refetch, journal }: {
  entity: string
  items: BulkDeleteItem[]
  remove: (id: string) => Promise<unknown>
  refetch: () => void
  journal: { kind: (id: string) => string; id: (id: string) => string } | null
}): Promise<BulkDeleteOutcome> {
  const deleted: string[] = []
  const kept: BulkDeleteItem[] = []

  await AtlasService.BeginUndoMark()
  try {
    for (const item of items) {
      try {
        await remove(item.id)
        deleted.push(item.id)
      } catch {
        kept.push(item)
      }
    }
  } finally {
    await AtlasService.EndUndoMark()
  }
  refetch()

  if (deleted.length > 0) {
    const lastID = deleted[deleted.length - 1]
    const message = outcomeMessage(entity, deleted.length, kept)
    useUndoDeleteStore.getState().show({
      key: `bulk-${entity}-${lastID}`,
      message,
      ...(journal
        ? {
          journalKind: journal.kind(lastID),
          journalId: journal.id(lastID),
          undo: async () => {
            await findCommand('atlas.undo')?.run()
            refetch()
          },
        }
        : { undo: null }),
    })
  }

  return { deleted, kept }
}
