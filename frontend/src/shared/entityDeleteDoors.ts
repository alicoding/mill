import type { EntityRowFamily, EntityRowItem } from './entityRowCommands'
import { CONFIGURE_ENTITY_FAMILIES } from './configureRowCommands'
import { BULK_DELETABLE_INVENTORY_FAMILIES } from './inventoryRowCommands'

// The generic list.deleteSelection command (shared/listSelectionCommands.ts,
// goal 0404 S1) needs, for whichever entity family the selected rows
// belong to, the SAME delete door and refetch its per-row Delete action
// already uses -- built from the identical family descriptors
// (shared/configureRowCommands.ts, shared/inventoryRowCommands.ts)
// entityRowCommands.ts mints a row's own action from, so a bulk delete
// can never drift from what a single row's Delete does. A family whose
// `remove` isn't the plain per-id function form (perspectives' own
// confirm-first delete) carries no bulk door -- it isn't one of the
// InventoryList consumers goal 0404 S1 wires selection into anyway.

export interface BulkDeleteDoor {
  remove: (id: string) => Promise<unknown>
  refetch: () => void
  // False only for Secrets (goal 0404 S1's amendment): its delete
  // registers no way back, so a bulk delete offers no Undo either --
  // an undo journal holding a deleted secret's value is the wrong
  // primitive (goal 0406 is the recently-deleted trash instead).
  undoable: boolean
}

function doorFor(family: EntityRowFamily<EntityRowItem>): BulkDeleteDoor | null {
  if (typeof family.remove !== 'function') return null
  const remove = family.remove
  return { remove: (id: string) => Promise.resolve(remove(id)), refetch: family.refetch, undoable: family.undoable !== false }
}

const REGISTRY: Record<string, BulkDeleteDoor> = Object.fromEntries(
  [...CONFIGURE_ENTITY_FAMILIES, ...BULK_DELETABLE_INVENTORY_FAMILIES]
    .map((family) => [family.entity, doorFor(family)] as const)
    .filter((entry): entry is [string, BulkDeleteDoor] => entry[1] !== null),
)

export function bulkDeleteDoorFor(entity: string): BulkDeleteDoor | undefined {
  return REGISTRY[entity]
}
