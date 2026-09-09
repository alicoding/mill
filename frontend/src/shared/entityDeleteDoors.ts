import type { EntityRowFamily, EntityRowItem, EntityRowRemove } from './entityRowCommands'
import { CONFIGURE_ENTITY_FAMILIES } from './configureRowCommands'
import { BULK_DELETABLE_INVENTORY_FAMILIES } from './inventoryRowCommands'
import { SecretService } from './bindings'

// The generic list.deleteSelection command (shared/listSelectionCommands.ts,
// goal 0404 S1) needs, for whichever entity family the selected rows
// belong to, the SAME delete door and refetch its per-row Delete action
// already uses -- built from the identical family descriptors
// (shared/configureRowCommands.ts, shared/inventoryRowCommands.ts)
// entityRowCommands.ts mints a row's own action from, so a bulk delete
// can never drift from what a single row's Delete does.

export interface BulkDeleteDoor {
  remove: (id: string) => Promise<unknown>
  refetch: () => void
  // False only for Secrets (goal 0404 S1's amendment): its delete
  // registers no way back, so a bulk delete offers no Undo either --
  // an undo journal holding a deleted secret's value is the wrong
  // primitive (goal 0406 is the recently-deleted trash instead).
  undoable: boolean
}

// A minimal stand-in for the row a bulk action only knows the id of --
// every EntityRowRemove.run/enabled this file calls reads nothing but
// ID (goal 0346's own EntityRowItem contract), the same minimal shape
// entityRowContext's own `find` falls back to for a family with no
// `load`.
function stubItem(id: string): EntityRowItem {
  return { ID: id, Label: '' }
}

// A family's `remove` is either the plain per-id function form
// (Configure entities, workflows) or the fuller EntityRowRemove shape
// (Secrets' `undo: false`, Perspectives' own confirm-first delete) --
// goal 0406 S2's amendment: this used to only handle the first form,
// silently leaving Secrets' own bulk Delete/Restore/Delete-forever
// unwired. `enabled` still gates a row this family can't delete (a
// source-backed key has no wrapping vault entry) the same way the
// single-row action already does.
function doorFor(family: EntityRowFamily<EntityRowItem>): BulkDeleteDoor {
  const remove = family.remove
  if (typeof remove === 'function') {
    return { remove: (id: string) => Promise.resolve(remove(id)), refetch: family.refetch, undoable: family.undoable !== false }
  }
  const { run, enabled } = remove as EntityRowRemove<EntityRowItem>
  return {
    remove: (id: string) => {
      const item = stubItem(id)
      if (enabled && !enabled(item)) return Promise.resolve()
      return Promise.resolve(run(item))
    },
    refetch: family.refetch,
    undoable: remove.undo !== false,
  }
}

const REGISTRY: Record<string, BulkDeleteDoor> = Object.fromEntries(
  [...CONFIGURE_ENTITY_FAMILIES, ...BULK_DELETABLE_INVENTORY_FAMILIES]
    .map((family) => [family.entity, doorFor(family)] as const),
)

export function bulkDeleteDoorFor(entity: string): BulkDeleteDoor | undefined {
  return REGISTRY[entity]
}

// The Trash section's own bulk door (goal 0406 S2): Restore and Delete
// forever, over a live multi-selection, the same shape BulkDeleteDoor
// gives Delete -- Secrets is currently the one family with a Trash
// (docs/goals/0406's Integration triage: PLATFORM, secrets-only), so
// this stays a small fixed registry rather than a third descriptor
// field every OTHER family would carry and never use. refetch is a
// no-op like Secrets' own BulkDeleteDoor: Trash/Restore/Destroy all
// emit the same 'secret' mill-data-changed event the mounted Trash
// section already refetches on.
export interface BulkTrashDoor {
  restore: (id: string) => Promise<unknown>
  destroy: (id: string) => Promise<unknown>
}

const TRASH_REGISTRY: Record<string, BulkTrashDoor> = {
  secret: { restore: (id) => SecretService.RestoreSecret(id), destroy: (id) => SecretService.DestroySecret(id) },
}

export function bulkTrashDoorFor(entity: string): BulkTrashDoor | undefined {
  return TRASH_REGISTRY[entity]
}
