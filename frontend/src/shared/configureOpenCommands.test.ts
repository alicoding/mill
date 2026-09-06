import { describe, expect, it } from 'vitest'
import { CONFIGURE_OPEN_COMMANDS } from './configureOpenCommands'
import { CONFIGURE_KINDS } from './configureKinds'
import { COMMANDS, commandLabel } from './commands'
import { useAppStore } from './store'

// One palette deep link per registered Configure kind (goal 0116),
// derived from the registry the way settings.open.<group> is derived
// from SETTINGS_GROUPS -- so a kind added to the registry is reachable
// from the palette without a hand-written command.
describe('CONFIGURE_OPEN_COMMANDS', () => {
  it('derives exactly one unbound command per kind, labeled by the kind', () => {
    expect(CONFIGURE_OPEN_COMMANDS.map((c) => c.id)).toEqual(CONFIGURE_KINDS.map((k) => `configure.open.${k.id}`))
    expect(CONFIGURE_OPEN_COMMANDS.every((c) => c.defaultBinding === null)).toBe(true)
    expect(commandLabel(CONFIGURE_OPEN_COMMANDS.find((c) => c.id === 'configure.open.lists')!)).toBe('Configure › Lists')
    expect(commandLabel(CONFIGURE_OPEN_COMMANDS.find((c) => c.id === 'configure.open.execenvs')!)).toBe('Configure › Execution Environments')
  })

  it('is registered in the live command table', () => {
    const ids = new Set(COMMANDS.map((c) => c.id))
    for (const c of CONFIGURE_OPEN_COMMANDS) expect(ids.has(c.id), c.id).toBe(true)
  })

  it('lands on the kind as a Configure view deep link', () => {
    CONFIGURE_OPEN_COMMANDS.find((c) => c.id === 'configure.open.decisions')!.run()
    expect(useAppStore.getState().view).toEqual({ kind: 'configure', tab: 'decisions' })
  })
})
