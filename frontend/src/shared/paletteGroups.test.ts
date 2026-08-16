import { describe, expect, it, vi } from 'vitest'
import { PALETTE_GROUP_ORDER, paletteGroupFor, shortLabel } from './paletteGroups'

// Every NodeType ID registered server-side (internal/domain/
// composition/*.go's RegisterNodeType call sites) as of design wave 3
// -- checked directly against the Go registry when paletteGroups.ts
// was written, not assumed. If a future PR adds a NodeType without
// updating composition/paletteGroups.ts's own NODE_TYPE_GROUP map,
// this list needs a matching update too -- the two are meant to drift
// together, not silently apart (this test is what makes an omission
// visible instead of silent).
const ALL_REGISTERED_NODE_TYPE_IDS = [
  'trigger-manual', 'trigger-hotkey', 'trigger-schedule', 'trigger-clipboard-watch',
  'trigger-filesystem-watch', 'trigger-callable', 'trigger-system-event', 'trigger-atlas-card',
  'capture-clipboard-html', 'capture-clipboard-info', 'capture-file', 'capture-attribute',
  'process-extract-html', 'process-html-to-markdown', 'process-inject-text',
  'process-ai-classify', 'process-ai-completion', 'process-ai-extract-structured',
  'list-lookup', 'list-search', 'process-run-receipt', 'process-atlas-card-find',
  'integration-http', 'mcp-tool-call', 'code-execution',
  'child-workflow', 'decision-route',
  'human-review', 'ruleset', 'decision-outcome',
  'apply-clipboard-write-html', 'apply-clipboard-write-text', 'apply-file-write',
  'apply-atlas-card-create', 'apply-atlas-card-update', 'apply-atlas-card-link',
  'apply-list-row',
]

describe('paletteGroupFor', () => {
  it('has exactly 37 registered node types accounted for', () => {
    expect(ALL_REGISTERED_NODE_TYPE_IDS).toHaveLength(37)
  })

  it('maps every registered NodeType ID to one of the 9 display groups, without warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const id of ALL_REGISTERED_NODE_TYPE_IDS) {
      const group = paletteGroupFor({ ID: id, Kind: 'process' })
      expect(PALETTE_GROUP_ORDER).toContain(group)
    }
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('falls back to the Kind\'s nearest group and warns, for an unknown ID -- never crashes', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const group = paletteGroupFor({ ID: 'totally-unregistered-future-node', Kind: 'apply' })
    expect(group).toBe('apply')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('totally-unregistered-future-node')
    warn.mockRestore()
  })

  it('falls back even for an unknown Kind, never throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => paletteGroupFor({ ID: 'mystery-node', Kind: 'mystery-kind' })).not.toThrow()
    warn.mockRestore()
  })

  // A declared step type (goal 0054 slice B) has no compile-time
  // NODE_TYPE_GROUP entry -- its own author-chosen PaletteGroup (set on
  // the synthesized NodeType, composition.NodeType.PaletteGroup) is the
  // only channel that group reaches the palette through. Without this,
  // every declared type would silently land in its engine's Kind
  // fallback ('process' -> 'actions') regardless of what the author
  // picked.
  it('honors a declared type\'s own PaletteGroup over the Kind fallback, without warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const group = paletteGroupFor({ ID: 'steptype-my-lookup', Kind: 'process', PaletteGroup: 'data' })
    expect(group).toBe('data')
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('ignores an empty or unrecognized PaletteGroup and falls back normally', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(paletteGroupFor({ ID: 'integration-http', Kind: 'process', PaletteGroup: '' })).toBe('actions')
    warn.mockRestore()
  })
})

describe('shortLabel', () => {
  it.each([
    ['AI: Classify', 'Classify'],
    ['Code: run command', 'Run command'],
    ['List: lookup', 'Lookup'],
    ['List: search', 'Search'],
    ['Integration: HTTP call', 'HTTP call'],
    ['MCP: tool call', 'Tool call'],
    ['Run another workflow', 'Run another workflow'],
    ['Human review', 'Human review'],
    ['Ruleset validation', 'Ruleset validation'],
    ['Trigger: manual', 'Manual'],
    ['Branch: route', 'Route'],
  ])('strips %j to %j', (input, expected) => {
    expect(shortLabel({ Label: input })).toBe(expected)
  })
})
