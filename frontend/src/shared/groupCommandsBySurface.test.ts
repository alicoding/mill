import { describe, expect, it } from 'vitest'
import { countCommandsByFacet, filterCommandsByChord, filterCommandsByFacet, groupCommandsBySurface } from './groupCommandsBySurface'
import type { Command } from './commandTypes'
import type { KeyCombo } from './keybinding'

function cmd(overrides: Partial<Command> & { id: string; label: string }): Command {
  return {
    defaultBinding: null,
    run: () => {},
    ...overrides,
  }
}

const zebra = cmd({ id: 'z', label: 'commands.zebra', defaultBinding: { mods: ['cmd'], key: 'Z' } })
const alpha = cmd({ id: 'a', label: 'commands.alpha', defaultBinding: { mods: ['cmd'], key: 'A' } })
const unboundOne = cmd({ id: 'u1', label: 'commands.unboundOne' })
const atlasBound = cmd({ id: 'atl', label: 'commands.atlasBound', defaultBinding: { mods: ['cmd'], key: 'U' }, surface: ['atlas'] })
const reviewUnbound = cmd({ id: 'rev', label: 'commands.reviewUnbound', surface: ['review'] })
const settingsBound = cmd({ id: 'set', label: 'commands.settingsBound', defaultBinding: { mods: ['cmd'], key: 'F' }, surface: ['settings'] })

describe('groupCommandsBySurface', () => {
  it('groups global (surface-less) commands under Everywhere, bound before unbound, alphabetical within bound', () => {
    const groups = groupCommandsBySurface([zebra, alpha, unboundOne], {})
    const everywhere = groups.find((g) => g.surface === 'everywhere')!
    expect(everywhere.label).toBe('keyboardShortcutsSection.surfaces.everywhere')
    expect(everywhere.bound.map((c) => c.id)).toEqual(['a', 'z'])
    expect(everywhere.unbound.map((c) => c.id)).toEqual(['u1'])
  })

  it('orders named surfaces Everywhere, Atlas, Workflows, Review regardless of input order', () => {
    const composition = cmd({ id: 'comp', label: 'commands.comp', defaultBinding: { mods: ['cmd'], key: 'C' }, surface: ['composition'] })
    const groups = groupCommandsBySurface([reviewUnbound, composition, atlasBound, alpha], {})
    expect(groups.map((g) => g.surface)).toEqual(['everywhere', 'atlas', 'composition', 'review'])
  })

  it('appends an unnamed surface (settings.search\'s own scope) after the four named ones, never dropping it', () => {
    const groups = groupCommandsBySurface([alpha, settingsBound], {})
    expect(groups.map((g) => g.surface)).toEqual(['everywhere', 'settings'])
    expect(groups.find((g) => g.surface === 'settings')!.label).toBe('keyboardShortcutsSection.surfaces.settings')
  })

  it('omits a surface with nothing left after the caller\'s own narrowing', () => {
    const groups = groupCommandsBySurface([alpha], {})
    expect(groups.map((g) => g.surface)).toEqual(['everywhere'])
  })

  it('counts only bound, overridden commands as customised -- an unbound command is never customised', () => {
    const overrides: Record<string, KeyCombo> = { a: { mods: ['cmd', 'shift'], key: 'A' } }
    const groups = groupCommandsBySurface([alpha, zebra, unboundOne], overrides)
    const everywhere = groups.find((g) => g.surface === 'everywhere')!
    expect(everywhere.customisedCount).toBe(1)
  })
})

describe('countCommandsByFacet', () => {
  it('counts over the given set regardless of which facet is currently active', () => {
    const overrides: Record<string, KeyCombo> = { a: { mods: ['cmd', 'shift'], key: 'A' } }
    const counts = countCommandsByFacet([alpha, zebra, unboundOne], overrides)
    expect(counts).toEqual({ all: 3, bound: 2, unbound: 1, customised: 1 })
  })
})

describe('filterCommandsByFacet', () => {
  const overrides: Record<string, KeyCombo> = { a: { mods: ['cmd', 'shift'], key: 'A' } }
  const set = [alpha, zebra, unboundOne]

  it('all is a no-op', () => {
    expect(filterCommandsByFacet(set, overrides, 'all')).toEqual(set)
  })

  it('bound keeps only bound commands', () => {
    expect(filterCommandsByFacet(set, overrides, 'bound').map((c) => c.id)).toEqual(['a', 'z'])
  })

  it('unbound keeps only unbound commands', () => {
    expect(filterCommandsByFacet(set, overrides, 'unbound').map((c) => c.id)).toEqual(['u1'])
  })

  it('customised keeps only overridden commands', () => {
    expect(filterCommandsByFacet(set, overrides, 'customised').map((c) => c.id)).toEqual(['a'])
  })
})

describe('filterCommandsByChord', () => {
  it('matches a command whose effective binding equals the captured chord', () => {
    const matches = filterCommandsByChord([alpha, zebra, unboundOne], {}, { mods: ['cmd'], key: 'A' })
    expect(matches.map((c) => c.id)).toEqual(['a'])
  })

  it('matches an override, not the stale default', () => {
    const overrides: Record<string, KeyCombo> = { a: { mods: ['cmd', 'shift'], key: 'A' } }
    expect(filterCommandsByChord([alpha], overrides, { mods: ['cmd'], key: 'A' })).toEqual([])
    expect(filterCommandsByChord([alpha], overrides, { mods: ['cmd', 'shift'], key: 'A' }).map((c) => c.id)).toEqual(['a'])
  })

  it('matches a read-only extraBinding alias, same as its primary combo', () => {
    const withAlias = cmd({
      id: 'pal', label: 'commands.pal', defaultBinding: { mods: ['cmd'], key: 'K' },
      extraBindings: [{ mods: ['cmd'], key: '/' }],
    })
    expect(filterCommandsByChord([withAlias], {}, { mods: ['cmd'], key: '/' }).map((c) => c.id)).toEqual(['pal'])
  })

  it('is mod-order-independent, same as the recorder\'s own comboKey', () => {
    const matches = filterCommandsByChord([alpha], {}, { mods: ['cmd'], key: 'a' })
    expect(matches.map((c) => c.id)).toEqual(['a'])
  })
})
