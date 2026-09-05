import type { Command } from './commands'
import type { CommandContext } from './commandContext'
import { entityContext } from './commandContext'
import { deleteWithUndo } from './deleteWithUndo'
import { useEntityActionErrorStore } from './entityActionErrorStore'
import { downloadJSON } from './downloadJSON'
import { describeSeedReset, type SeedLike } from './seedLifecycle'

// One descriptor per entity family, minted into that family's whole row
// action set (goal 0346). Before this, every inventory page authored its
// own `onClick: () => remove(id, label)` closure straight onto the row,
// so the action existed nowhere but that render: unreachable from the
// palette, unbindable, its enablement an inline `? :` in the array
// literal, and its label duplicated per surface. A row now supplies WHICH
// entity (a `{ kind: 'entity', entity, id }` context) and nothing else.
//
// A new family is ONE descriptor, never N handlers: the fields below are
// the family's own RPCs and navigation, and this file decides what each
// action is called, when it is available, and what it reports on failure.
// An action only this family has arrives as an `extras` entry -- still a
// descriptor field, still minted here, never a bespoke handler on the row.

/** The minimum every family's row type carries. */
export interface EntityRowItem {
  ID: string
  Label: string
}

export interface EntityRowExtra<T> {
  /** appended to the family's namespace to form the command id */
  suffix: string
  /** a locale key, resolved by commandLabel() like every other command */
  label: string
  enabled?: (item: T) => boolean
  run: (item: T) => void | Promise<unknown>
}

export interface EntityRowFamily<T extends EntityRowItem> {
  /**
   * The family slug, spelled the same way every other surface already
   * spells it: InventoryItem.entity, ENTITY_ICON's key, and the
   * data-event name deleteWithUndo restores through.
   */
  entity: string
  /** Command-id namespace -- `configure.list` mints `configure.list.delete`. */
  namespace: string
  /**
   * The family's rows, read from the store the page already renders
   * from. Omit when the family's rows live in a view's own state and
   * none of its actions need more than the row's id -- every command
   * then acts on the context's id alone, and `Label` reads as empty.
   */
  load?: () => T[] | null | undefined
  /** Re-read the family after a mutation. */
  refetch: () => void
  /** Open this row's own editor. Omitted where the row itself is the editor. */
  edit?: (item: T) => void
  /** Start a create form prefilled from this row. */
  duplicate?: (item: T) => void
  /** The family's export RPC; the download is named from the row's label. */
  exportEntity?: (id: string) => Promise<string>
  /** The family's reset-to-shipped-example RPC. */
  reset?: (id: string) => Promise<unknown>
  /** This row's seed provenance, for deciding whether a reset has anything to do. */
  seedOf?: (item: T) => SeedLike
  /** The revision currently shipped for this row (the SeedRevisions map). */
  shippedRevision?: (item: T) => number
  /** The family's delete RPC. */
  remove: (id: string) => Promise<unknown>
  /**
   * Whether the delete posts the undo toast. True by default, which is
   * right for every ConfigureService family -- its own delete registers
   * the way back (configureservice_undodelete.go). A family whose
   * service registers nothing must set this false: a toast offering an
   * Undo that always fails is worse than no toast.
   */
  undoable?: boolean
  /** Actions only this family has. */
  extras?: EntityRowExtra<T>[]
}

/** The context a row hands its own actions. */
export function entityRowContext(entity: string, id: string): CommandContext {
  return { kind: 'entity', entity, id }
}

// A reset only ever has something to do on a built-in-origin row whose
// content has drifted from the shipped golden -- describeSeedReset is
// the one place that judgement lives (docs/goals/0037 item 4), and it
// now answers Command.enabled() rather than an inline `? :` deciding
// whether to even build the menu entry.
function resetActionable<T extends EntityRowItem>(family: EntityRowFamily<T>, item: T): boolean {
  if (!family.seedOf) return false
  const seed = family.seedOf(item)
  const current = family.shippedRevision?.(item) ?? seed.SeedRevision
  return !describeSeedReset(seed, current).disabled
}

export function entityRowCommands<T extends EntityRowItem>(family: EntityRowFamily<T>): Command[] {
  const find = (ctx?: CommandContext): T | undefined => {
    const target = entityContext(ctx, family.entity)
    if (!target) return undefined
    if (!family.load) return { ID: target.id, Label: '' } as T
    return (family.load() ?? []).find((x) => x.ID === target.id)
  }

  // Every command below shares this shape: it needs an 'entity' context,
  // and it is honestly unavailable when that context names a different
  // family or a row this family no longer holds. A rejected RPC is
  // recorded beside the family's own list (shared/entityActionErrorStore.ts)
  // AND rethrown, so runCommand posts the footer's error pill too -- one
  // refusal, the two places a reader could be looking.
  const make = (suffix: string, label: string, run: (item: T) => void | Promise<unknown>, available?: (item: T) => boolean): Command => ({
    id: `${family.namespace}.${suffix}`,
    label,
    defaultBinding: null,
    needs: 'entity',
    enabled: (ctx) => {
      const item = find(ctx)
      if (!item) return false
      return available ? available(item) : true
    },
    run: async (ctx) => {
      const item = find(ctx)
      if (!item) return
      const errors = useEntityActionErrorStore.getState()
      errors.clearError(family.entity)
      try {
        await run(item)
      } catch (err) {
        errors.setError(family.entity, String(err))
        throw err
      }
    },
  })

  const commands: Command[] = []

  if (family.edit) {
    const edit = family.edit
    commands.push(make('edit', `commands.${family.namespace}.edit`, (item) => edit(item)))
  }
  if (family.duplicate) {
    const duplicate = family.duplicate
    commands.push(make('duplicate', `commands.${family.namespace}.duplicate`, (item) => duplicate(item)))
  }
  for (const extra of family.extras ?? []) {
    commands.push(make(extra.suffix, extra.label, (item) => extra.run(item), extra.enabled))
  }
  if (family.exportEntity) {
    const exportEntity = family.exportEntity
    commands.push(make('export', `commands.${family.namespace}.export`, async (item) => {
      const json = await exportEntity(item.ID)
      await downloadJSON(`${item.Label.trim() || family.entity}.json`, json)
    }))
  }
  if (family.reset) {
    const reset = family.reset
    commands.push(make('reset', `commands.${family.namespace}.reset`, async (item) => {
      await reset(item.ID)
      family.refetch()
    }, (item) => resetActionable(family, item)))
  }
  // Delete last, and always present: a seeded example is as deletable as
  // anything the user authored (docs/SPEC.md §2.2), and the way back is
  // the undo toast rather than a question asked up front
  // (.claude/rules/frontend.md's button semantics).
  commands.push(make('delete', `commands.${family.namespace}.delete`, async (item) => {
    if (family.undoable === false) {
      await family.remove(item.ID)
      family.refetch()
      return
    }
    await deleteWithUndo({
      entity: family.entity,
      id: item.ID,
      label: item.Label,
      remove: () => family.remove(item.ID),
      refetch: family.refetch,
    })
  }))

  return commands
}
