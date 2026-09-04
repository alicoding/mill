import { describe, expect, it, afterEach } from 'vitest'
import { copy, installCopyResolver, resetCopyResolver } from './copy'
import { COMMANDS, commandLabel } from './commands'
import { MENU_SKELETON } from './menuSkeleton'
import { ATLAS_TOOL_IDENTITIES } from './atlasToolIdentity'
import { SETTINGS_GROUPS } from './settingsGroups'
import { menuSpecFor } from './menuSpec'
import { updateSeatFor } from './updateSeat'
import { vaultSeatFor } from './vaultSeat'
import { UpdateState } from './bindings'

afterEach(() => { resetCopyResolver() })

describe('copy() before any resolver is installed', () => {
  it('resolves a key against the statically-bundled English, so a registry built at module-eval reads real copy', () => {
    expect(copy('commands.workflow.new')).toBe('New workflow')
  })

  it('resolves a namespaced key the same way i18next would', () => {
    expect(copy('atlas:cardNoun.name')).toBe('Card')
  })

  it('interpolates {{placeholders}} without i18next', () => {
    expect(copy('seats.update.available', { version: '1.2.3' })).toBe('Download and install v1.2.3…')
  })

  it('returns an unresolvable key verbatim rather than throwing, which is how a plugin\'s own English label passes through', () => {
    expect(copy('Refresh the board index')).toBe('Refresh the board index')
    expect(copy('commands.nope.missing')).toBe('commands.nope.missing')
  })
})

describe('copy() once app/i18n.ts installs i18next\'s t()', () => {
  it('routes through the installed resolver', () => {
    installCopyResolver((key, params) => `resolved:${key}:${params?.version ?? ''}`)
    expect(copy('commands.workflow.new')).toBe('resolved:commands.workflow.new:')
    expect(copy('seats.update.available', { version: '9' })).toBe('resolved:seats.update.available:9')
  })

  it('goes back to the bundle when the resolver is torn down', () => {
    installCopyResolver(() => 'installed')
    resetCopyResolver()
    expect(copy('commands.workflow.new')).toBe('New workflow')
  })
})

// The gate the ESLint rule cannot give: eslint-plugin-i18next's own
// VariableDeclarator visitor skips the whole initializer of any
// SCREAMING_CASE const, so every module-scope registry here is
// invisible to it. These assertions are what stop a new registry entry
// carrying a sentence instead of a key.
function resolves(key: string): boolean {
  return copy(key) !== key
}

// The declared strings a caller hands in, minus the ones a noun simply
// omits -- what is left must every one resolve.
function unresolvedIn(keys: (string | undefined)[]): string[] {
  return keys.filter((k): k is string => k !== undefined).filter((k) => !resolves(k))
}

function skeletonSlotLabels(menu: (typeof MENU_SKELETON)[number]): (string | undefined)[] {
  return (menu.groups ?? []).flat().flatMap((slot) => [
    'submenu' in slot ? slot.submenu.label : undefined,
    'commandRef' in slot ? slot.label : undefined,
  ])
}

function unresolvedSkeletonLabels(): string[] {
  return unresolvedIn(MENU_SKELETON.flatMap((m) => [m.label, ...skeletonSlotLabels(m)]))
}

describe('every module-scope registry holds a locale key, never a sentence', () => {
  // Two command families name a runtime value in their label
  // ("Settings > Appearance", "Remove <plugin>"), so their arrays call
  // copy() themselves at construction and carry the RESOLVED string --
  // there is no static key that could hold them. Everything else holds
  // a key.
  const INTERPOLATED_AT_CONSTRUCTION = /^(settings\.open\.|plugin\.remove\.)/
  it('resolves every command label', () => {
    const unresolved = COMMANDS
      .filter((c) => !INTERPOLATED_AT_CONSTRUCTION.test(c.id))
      .filter((c) => !resolves(c.label))
      .map((c) => `${c.id}: ${c.label}`)
    expect(unresolved).toEqual([])
  })

  it('still renders real English for the two interpolated families', () => {
    const appearance = COMMANDS.find((c) => c.id === 'settings.open.appearance')!
    expect(commandLabel(appearance)).toBe('Settings › Appearance')
  })

  it('resolves every menu title and submenu label in the skeleton', () => {
    expect(unresolvedSkeletonLabels()).toEqual([])
  })

  it('resolves every atlas tool identity\'s command label', () => {
    expect(ATLAS_TOOL_IDENTITIES.filter((t) => !resolves(t.commandLabel))).toEqual([])
  })

  it('resolves every Settings group title', () => {
    expect(SETTINGS_GROUPS.filter((g) => !resolves(`views:${g.titleKey}`))).toEqual([])
  })

  it('resolves every static seat label', () => {
    const seats = [
      updateSeatFor(UpdateState.UpdateStateIdle, ''),
      updateSeatFor(UpdateState.UpdateStateChecking, ''),
      updateSeatFor(UpdateState.UpdateStateReady, ''),
      vaultSeatFor({ Unlocked: true, Exists: true } as never),
      vaultSeatFor({ Unlocked: false, Exists: true } as never),
    ]
    expect(seats.filter((s) => !resolves(s.label))).toEqual([])
  })
})

describe('the menu-bar projection resolves what the registries hold', () => {
  it('renders English titles and item labels, never key paths', () => {
    const spec = menuSpecFor(COMMANDS)
    expect(spec.menus.map((m) => m.label)).toContain('File')
    const view = spec.menus.find((m) => m.label === 'View')!
    const labels = view.kind === 'menu' ? view.groups.flat().map((e) => ('label' in e ? e.label : '')) : []
    expect(labels).toContain('Home')
    expect(labels.some((l) => l.startsWith('commands.') || l.startsWith('menu.'))).toBe(false)
  })
})

describe('every noun\'s own display fields are keys too', () => {
  it('resolves the label, description and shield hint each declaring noun carries', async () => {
    const { ATLAS_TOOLS } = await import('../atlas/atlasTools')
    const { toolLessNounExtensions } = await import('../atlas/atlasNounRegistry')
    const inTree = ATLAS_TOOLS.filter((t) => !('thirdParty' in t && t.thirdParty))
    const declared = [
      ...inTree.flatMap((t) => [t.nounName, t.description, t.content?.shieldHintKey]),
      ...toolLessNounExtensions().flatMap((n) => [
        n.extension.label, n.extension.description, n.extension.disableScopeNote, n.content.shieldHintKey,
      ]),
    ]
    expect(unresolvedIn(declared)).toEqual([])
  })

  it('gives each shielded noun its own first-click sentence rather than one standing in for all three', () => {
    expect(copy('atlas:diagramNoun.shieldHint')).toBe('Click to select, then drag to pan')
    expect(copy('atlas:pdfNoun.shieldHint')).toBe('Click to select, then scroll to read')
    expect(copy('atlas:tableNoun.shieldHint')).toBe('Click to select, then click a cell to edit')
  })
})

describe('the reload-refusal vocabulary reads as sentences', () => {
  it('states each refusal without a dash clause', () => {
    const keys = ['disabled', 'blocked', 'unallowed', 'unsigned', 'changed']
    for (const k of keys) {
      const text = copy(`views:settings.extensions.reloadRefusal.${k}`)
      expect(text).not.toContain(' -- ')
      expect(text).not.toContain('reloadRefusal')
    }
    expect(copy('views:settings.extensions.reloadRefusal.changed'))
      .toBe('its files changed since you allowed it. Allow it again on its row')
  })
})

describe('commandLabel', () => {
  it('is the one resolver every command surface reads through', () => {
    const newWorkflow = COMMANDS.find((c) => c.id === 'workflow.new')!
    expect(commandLabel(newWorkflow)).toBe('New workflow')
  })
})
