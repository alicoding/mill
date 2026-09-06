import { describe, expect, it } from 'vitest'
import {
  CONFIGURE_GROUPS,
  CONFIGURE_KINDS,
  DEFAULT_CONFIGURE_KIND,
  filterConfigureKinds,
  groupConfigureKinds,
  groupForKind,
  isConfigureKind,
  resolveConfigureKind,
  resolveKindLabel,
  type ConfigureKind,
} from './configureKinds'
import { hashForKind, isConfigureHash, kindFromHash } from '../configure/configureRoute'
import { CONFIGURE_CREATE_COMMANDS } from './configureCreateCommands'

// The Configure kind registry and its route (goal 0116). Pinned as
// DATA, not just types: the ORDER is the reading order of the rail,
// the grouping is the rail's sections, and the ids are a public
// surface -- the route, the deep-link value, the navigate target and
// the `configure.open.<id>` / `configure.new.<id>` command suffixes --
// so a rename is a breaking change a test should force on purpose.
describe('CONFIGURE_KINDS', () => {
  it('is the eleven kinds in four groups, in reading order', () => {
    expect(groupConfigureKinds(CONFIGURE_KINDS).map((g) => [g.group.id, g.kinds.map((k) => k.id)])).toEqual([
      ['connections', ['integration', 'mcpservers', 'aiproviders', 'certificates']],
      ['runtime', ['environments', 'execenvs']],
      ['data', ['lists', 'attributes', 'conversionprofiles']],
      ['workflowLogic', ['decisions', 'steptypes']],
    ])
  })

  it('resolves every label from the shipped copy, never falling back to the key', () => {
    expect(CONFIGURE_KINDS.map(resolveKindLabel)).toEqual([
      'Integrations', 'MCP Servers', 'AI Providers', 'Certificates',
      'Environments', 'Execution Environments',
      'Lists', 'Attributes', 'Conversion profiles',
      'Decisions', 'Step types',
    ])
  })

  it('names a create command only where one is registered', () => {
    const registered = new Set(CONFIGURE_CREATE_COMMANDS.map((c) => c.id))
    for (const kind of CONFIGURE_KINDS) {
      if (kind.createCommandId) expect(registered.has(kind.createCommandId), kind.id).toBe(true)
    }
    expect(CONFIGURE_KINDS.find((k) => k.id === 'attributes')?.createCommandId).toBeUndefined()
    expect(CONFIGURE_KINDS.filter((k) => k.createCommandId).length).toBe(CONFIGURE_CREATE_COMMANDS.length)
  })

  it('defaults to Integrations and recognizes only real ids', () => {
    expect(DEFAULT_CONFIGURE_KIND).toBe('integration')
    expect(isConfigureKind('lists')).toBe(true)
    // Secret sources left Configure (shared/viewRedirects.ts sends the
    // old tab to Secrets), so its old id is not a kind.
    expect(isConfigureKind('secretsources')).toBe(false)
    expect(isConfigureKind(undefined)).toBe(false)
    expect(resolveConfigureKind('nonsense')).toBe('integration')
    expect(resolveConfigureKind('decisions')).toBe('decisions')
  })

  it('places a plugin-contributed kind under From extensions, whatever group it names', () => {
    const fromPlugin: ConfigureKind = {
      id: 'zz-plugin-kind',
      labelKey: 'configureView.lists',
      icon: CONFIGURE_KINDS[0].icon,
      group: 'data',
      source: { plugin: 'example.plugin' },
    }
    expect(groupForKind(fromPlugin)).toBe('extensions')
    const grouped = groupConfigureKinds([...CONFIGURE_KINDS, fromPlugin])
    expect(grouped[grouped.length - 1].group.id).toBe('extensions')
    expect(grouped[grouped.length - 1].kinds.map((k) => k.id)).toEqual(['zz-plugin-kind'])
    // Built-in groups are untouched by the addition.
    expect(grouped.slice(0, -1).map((g) => g.group.id)).toEqual(['connections', 'runtime', 'data', 'workflowLogic'])
    // And the group is absent while no extension contributes a kind.
    expect(groupConfigureKinds(CONFIGURE_KINDS).some((g) => g.group.id === 'extensions')).toBe(false)
    expect(CONFIGURE_GROUPS.map((g) => g.id)).toEqual(['connections', 'runtime', 'data', 'workflowLogic', 'extensions'])
  })

  it('filters labels across groups, case-insensitively, keeping everything on an empty query', () => {
    const byLabel = (q: string) => groupConfigureKinds(filterConfigureKinds(CONFIGURE_KINDS, q, resolveKindLabel)).map((g) => [g.group.id, g.kinds.map((k) => k.id)])
    expect(byLabel('env')).toEqual([['runtime', ['environments', 'execenvs']]])
    expect(byLabel('  LIST ')).toEqual([['data', ['lists']]])
    expect(byLabel('zzz')).toEqual([])
    expect(filterConfigureKinds(CONFIGURE_KINDS, '', resolveKindLabel)).toBe(CONFIGURE_KINDS)
  })
})

describe('the #/configure route', () => {
  it('decodes a kind, treats a bare #/configure as Integrations, and ignores every other hash', () => {
    expect(kindFromHash('#/configure/lists')).toBe('lists')
    expect(kindFromHash('#/configure')).toBe('integration')
    expect(kindFromHash('#/configure/nonsense')).toBe('integration')
    expect(kindFromHash('#/settings/general')).toBeNull()
    expect(kindFromHash('#/quickpanel')).toBeNull()
    expect(kindFromHash('')).toBeNull()
    expect(isConfigureHash('#/configure/decisions')).toBe(true)
    expect(isConfigureHash('#/configured')).toBe(false)
  })

  it('round-trips every kind through its own hash', () => {
    for (const kind of CONFIGURE_KINDS) {
      expect(kindFromHash(hashForKind(kind.id))).toBe(kind.id)
    }
  })
})
