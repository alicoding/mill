import { beforeEach, describe, expect, it, vi } from 'vitest'
import { entityRowCommands, entityRowContext, type EntityRowFamily, type EntityRowItem } from './entityRowCommands'
import { commandAvailable, findCommand } from './commands'
import { useConfigureEntityStore } from './configureEntityStore'
import { useSeedRevisionStore } from './seedRevisionStore'
import { useAppStore } from './store'
import type { CommandContext } from './commandContext'

// goal 0346: one descriptor per entity family, minted into that
// family's whole row action set. What is pinned here is the CONTRACT a
// new family gets for free -- which commands exist, which context they
// accept, and what makes each one unavailable -- not any single
// family's RPC wiring.

interface Row extends EntityRowItem {
  Seed: { SeedRevision: number; Modified: boolean }
}

function row(id: string, seed: { SeedRevision: number; Modified: boolean }): Row {
  return { ID: id, Label: `Row ${id}`, Seed: seed }
}

function family(overrides: Partial<EntityRowFamily<Row>> = {}): EntityRowFamily<Row> {
  return {
    entity: 'widget',
    namespace: 'configure.widget',
    load: () => [row('w-1', { SeedRevision: 3, Modified: false })],
    refetch: () => {},
    remove: () => Promise.resolve(),
    ...overrides,
  }
}

const ctx = (id = 'w-1', entity = 'widget'): CommandContext => entityRowContext(entity, id)

describe('entityRowCommands (goal 0346)', () => {
  it('mints only the actions the descriptor declares, delete always last', () => {
    const minimal = entityRowCommands(family())
    expect(minimal.map((c) => c.id)).toEqual(['configure.widget.delete'])

    const full = entityRowCommands(family({
      edit: () => {},
      duplicate: () => {},
      exportEntity: () => Promise.resolve('{}'),
      reset: () => Promise.resolve(),
      seedOf: (item) => item.Seed,
      extras: [{ suffix: 'listTools', label: 'commands.x.listTools', run: () => {} }],
    }))
    expect(full.map((c) => c.id)).toEqual([
      'configure.widget.edit',
      'configure.widget.duplicate',
      'configure.widget.listTools',
      'configure.widget.export',
      'configure.widget.reset',
      'configure.widget.delete',
    ])
  })

  it('every minted command needs an entity context and refuses another family or an unknown row', () => {
    const [del] = entityRowCommands(family())
    expect(del.needs).toBe('entity')
    expect(commandAvailable(del, ctx())).toBe(true)
    // Same discriminant, different family -- contextSatisfies alone
    // would let this through, which is why enabled() checks the slug.
    expect(commandAvailable(del, ctx('w-1', 'gadget'))).toBe(false)
    expect(commandAvailable(del, ctx('w-missing'))).toBe(false)
    expect(commandAvailable(del, { kind: 'workflow', workflowId: 'w-1' })).toBe(false)
    expect(commandAvailable(del, undefined)).toBe(false)
  })

  it('reset is available only while the row has drifted from the shipped golden', () => {
    const withReset = (seed: { SeedRevision: number; Modified: boolean }, shipped: number) => {
      const commands = entityRowCommands(family({
        load: () => [row('w-1', seed)],
        reset: () => Promise.resolve(),
        seedOf: (item) => item.Seed,
        shippedRevision: () => shipped,
      }))
      return commands.find((c) => c.id === 'configure.widget.reset')!
    }
    // Pristine and current: nothing to restore.
    expect(commandAvailable(withReset({ SeedRevision: 3, Modified: false }, 3), ctx())).toBe(false)
    // Edited by the user.
    expect(commandAvailable(withReset({ SeedRevision: 3, Modified: true }, 3), ctx())).toBe(true)
    // Untouched, but a later release ships a newer golden.
    expect(commandAvailable(withReset({ SeedRevision: 3, Modified: false }, 4), ctx())).toBe(true)
  })

  it('delete routes through the undo buffer by default and skips it for a family whose service registers none', async () => {
    const remove = vi.fn(() => Promise.resolve())
    const refetch = vi.fn()
    const undoable = entityRowCommands(family({ remove, refetch }))[0]
    await undoable.run(ctx())
    expect(remove).toHaveBeenCalledWith('w-1')
    expect(refetch).toHaveBeenCalled()

    const plain = entityRowCommands(family({ remove, refetch, undoable: false }))[0]
    await plain.run(ctx())
    expect(remove).toHaveBeenCalledTimes(2)
  })

  it('a family with no load acts on the context id alone', async () => {
    const remove = vi.fn(() => Promise.resolve())
    const [del] = entityRowCommands({
      entity: 'secret', namespace: 'secret.row', refetch: () => {}, remove, undoable: false,
    })
    expect(commandAvailable(del, ctx('s-9', 'secret'))).toBe(true)
    await del.run(ctx('s-9', 'secret'))
    expect(remove).toHaveBeenCalledWith('s-9')
  })
})

// The real descriptor table, checked against the registry every surface
// reads -- so a family added to shared/configureRowCommands.ts without
// its locale keys or with a mistyped slug fails here, not in a menu.
describe('the registered Configure row commands', () => {
  beforeEach(() => {
    useSeedRevisionStore.setState({ configure: {}, workflow: {} })
  })

  const families: Array<[string, string[]]> = [
    ['request', ['edit', 'export', 'reset', 'delete']],
    ['list', ['export', 'reset', 'delete']],
    ['mcpserver', ['listTools', 'export', 'reset', 'delete']],
    ['decision', ['duplicate', 'export', 'reset', 'delete']],
    ['execenv', ['export', 'reset', 'delete']],
    ['aiprovider', ['export', 'reset', 'delete']],
    ['steptype', ['export', 'delete']],
    ['conversionprofile', ['delete']],
    ['secretsource', ['delete']],
  ]

  it.each(families)('%s has exactly its declared actions, each with a resolved label', (entity, actions) => {
    for (const action of actions) {
      const command = findCommand(`configure.${entity}.${action}`)
      expect(command, `configure.${entity}.${action}`).toBeDefined()
      // An unresolvable key comes back verbatim (shared/copy.ts), so a
      // label still holding a dot-path means the key is missing.
      expect(command!.label).toBe(`commands.configure.${entity}.${action}`)
      expect(command!.needs).toBe('entity')
    }
  })

  it('a Configure row command is unavailable while its family holds no such row', () => {
    useConfigureEntityStore.setState({ lists: [] })
    const del = findCommand('configure.list.delete')!
    expect(commandAvailable(del, entityRowContext('list', 'l-1'))).toBe(false)
    useConfigureEntityStore.setState({
      lists: [{ ID: 'l-1', Label: 'Regions', Seed: { SeedRevision: 1, Modified: true } } as never],
    })
    expect(commandAvailable(del, entityRowContext('list', 'l-1'))).toBe(true)
    expect(commandAvailable(findCommand('configure.list.reset')!, entityRowContext('list', 'l-1'))).toBe(true)
  })

  it('the two inventories outside Configure share the same contract', () => {
    useAppStore.setState({ workflows: [], nodeTypes: null })
    const edit = findCommand('workflow.row.edit')!
    expect(edit.needs).toBe('entity')
    expect(commandAvailable(edit, entityRowContext('workflow', 'wf-1'))).toBe(false)
    for (const id of ['secret.row.edit', 'secret.row.history', 'secret.row.delete']) {
      expect(commandAvailable(findCommand(id)!, entityRowContext('secret', 's-1'))).toBe(true)
    }
  })
})

describe('entityRowCommands toggles and confirmed removes (goal 0346 slice B)', () => {
  it('a toggle mints an on/off pair, each available only while it would change something', () => {
    let on = false
    const commands = entityRowCommands(family({
      toggles: [{
        on: { suffix: 'enable', label: 'commands.x.enable' },
        off: { suffix: 'disable', label: 'commands.x.disable' },
        isOn: () => on,
        set: (_item, next) => { on = next },
        enabled: (item) => item.ID !== 'w-locked',
      }],
    }))
    expect(commands.map((c) => c.id)).toEqual(['configure.widget.enable', 'configure.widget.disable', 'configure.widget.delete'])
    const enable = commands[0]
    const disable = commands[1]
    expect(commandAvailable(enable, ctx())).toBe(true)
    expect(commandAvailable(disable, ctx())).toBe(false)
    on = true
    expect(commandAvailable(enable, ctx())).toBe(false)
    expect(commandAvailable(disable, ctx())).toBe(true)
  })

  it('a non-undo remove keeps its own suffix and label, and phrases its confirm from the row', () => {
    const removed: string[] = []
    const commands = entityRowCommands(family({
      remove: {
        suffix: 'remove',
        label: 'commands.extension.remove',
        undo: false,
        confirm: { title: 'confirmDelete.title', body: 'confirmDelete.body' },
        run: (item) => { removed.push(item.ID) },
      },
    }))
    const remove = commands.find((c) => c.id === 'configure.widget.remove')!
    expect(remove.confirm?.(ctx())).toEqual({ title: 'Delete widget?', body: 'This permanently deletes "Row w-1". This cannot be undone.', confirmLabel: undefined })
    expect(remove.confirm?.(ctx('ghost'))).toBeNull()
    return Promise.resolve(remove.run(ctx())).then(() => expect(removed).toEqual(['w-1']))
  })
})
