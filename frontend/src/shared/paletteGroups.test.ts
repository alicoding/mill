import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { PALETTE_GROUP_ORDER, paletteGroupFor, shortLabel } from './paletteGroups'

// The committed contract export (`go generate ./internal/contract/...`,
// goal 0134) is the live registry snapshot -- reading it directly (never
// a list retyped by hand into this file) is what makes a new NodeType
// shipping without a PaletteGroup show up here as a real failure instead
// of silent drift (goal 0389: the previous version of this file kept its
// own frozen 38-id list, which had already missed 12 registered types).
interface ContractNodeType {
  ID: string
  Kind: string
  PaletteGroup: string
}
const CONTRACT_PATH = path.resolve(__dirname, '../../../internal/contract/contract.json')
const contractNodeTypes: ContractNodeType[] = JSON.parse(readFileSync(CONTRACT_PATH, 'utf8')).nodeTypes

describe('paletteGroupFor', () => {
  it('has at least one registered node type to check (the contract file loaded)', () => {
    expect(contractNodeTypes.length).toBeGreaterThan(0)
  })

  it('maps every node type in the contract export to one of the declared display groups, without warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const nt of contractNodeTypes) {
      expect(PALETTE_GROUP_ORDER, `node type ${nt.ID} has PaletteGroup ${JSON.stringify(nt.PaletteGroup)}`).toContain(nt.PaletteGroup)
      expect(paletteGroupFor(nt)).toBe(nt.PaletteGroup)
    }
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('falls back to Actions and warns, for an invalid PaletteGroup -- never crashes', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const group = paletteGroupFor({ ID: 'totally-unregistered-future-node', Kind: 'apply', PaletteGroup: '' })
    expect(group).toBe('actions')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('totally-unregistered-future-node')
    warn.mockRestore()
  })

  it('honors a declared type\'s own PaletteGroup, without warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const group = paletteGroupFor({ ID: 'steptype-my-lookup', Kind: 'process', PaletteGroup: 'data' })
    expect(group).toBe('data')
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('shortLabel', () => {
  it.each([
    // Built-in NodeType labels are verb-first with no prefix (goal
    // 0113) -- these cases exercise a declared/legacy step type still
    // authoring the older "Group: specifics" colon style.
    ['Legacy: lookup', 'Lookup'],
    ['Custom: run script', 'Run script'],
    ['Run another workflow', 'Run another workflow'],
    ['Ask for review', 'Ask for review'],
    ['Validate with rules', 'Validate with rules'],
    ['Manual run', 'Manual run'],
    ['Branch', 'Branch'],
  ])('strips %j to %j', (input, expected) => {
    expect(shortLabel({ Label: input })).toBe(expected)
  })
})
