import { describe, expect, it } from 'vitest'
import { ATLAS_TOOLS } from '../atlas/atlasTools'
import { toolLessNounExtensions } from '../atlas/atlasNounRegistry'
import {
  descriptionLabel, editRouteLabel, groupLabel, reachLabel, sourceLabel, versionLabel,
  toolLessRowSource, toolRowSource,
} from './extensionMeta'

describe('groupLabel', () => {
  it('maps every declared group to user-facing text', () => {
    expect(groupLabel('knowledge')).toBe('Knowledge')
    expect(groupLabel('file')).toBe('File')
    expect(groupLabel('annotate')).toBe('Drawing')
  })
})

describe('sourceLabel', () => {
  it('maps every ObjectSource kind', () => {
    expect(sourceLabel({ kind: 'board-local' })).toBe('Stored on the board')
    expect(sourceLabel({ kind: 'file', pathKey: 'mirrorPath' })).toBe('Backed by a file')
    expect(sourceLabel({ kind: 'provider', refKey: 'listID' })).toBe('Live view of a List')
  })

  it('returns null for a tool with no declared source', () => {
    expect(sourceLabel(undefined)).toBeNull()
  })
})

describe('editRouteLabel', () => {
  it('maps every static EditRoute kind', () => {
    expect(editRouteLabel({ kind: 'external-app' })).toBe('Opens in your default app')
    expect(editRouteLabel({ kind: 'embedded-engine', engine: 'drawio' })).toBe('Edits in drawio')
    expect(editRouteLabel({ kind: 'inline' })).toBe('Edits in place')
  })

  it('returns null for "none" -- no separate edit door to describe', () => {
    expect(editRouteLabel({ kind: 'none' })).toBeNull()
  })

  it('returns null for a tool with no declared editRoute', () => {
    expect(editRouteLabel(undefined)).toBeNull()
  })

  it('falls back to one honest generic phrase for a per-object resolver', () => {
    expect(editRouteLabel(() => ({ kind: 'external-app' }))).toBe('Edit method depends on the file')
  })
})

describe('descriptionLabel', () => {
  it('returns the declared description when present', () => {
    expect(descriptionLabel({ description: 'Draws things.', label: 'Shape' })).toBe('Draws things.')
  })

  it('falls back to the label when no description is declared', () => {
    expect(descriptionLabel({ label: 'Shape' })).toBe('Shape')
  })
})

describe('reachLabel', () => {
  it('reads honestly when no capabilities are declared', () => {
    expect(reachLabel(undefined)).toBe('Reaches nothing outside Mill.')
    expect(reachLabel([])).toBe('Reaches nothing outside Mill.')
  })

  it('lists declared capabilities verbatim, derived rather than hardcoded', () => {
    expect(reachLabel(['network: example.com'])).toBe('Reaches network: example.com.')
    expect(reachLabel(['read files', 'write files'])).toBe('Reaches read files, write files.')
  })
})

describe('versionLabel', () => {
  it('reads the app\'s own build version -- every extension ships with Mill itself', () => {
    expect(versionLabel('1.2.3')).toBe('Ships with Mill v1.2.3')
  })
})

describe('toolRowSource (goal 0237 S3 rider)', () => {
  it('normalizes a tray tool into a row, carrying its group and content declarations', () => {
    const shape = ATLAS_TOOLS.find((t) => t.id === 'shape')!
    const row = toolRowSource(shape)
    expect(row).toEqual({
      id: 'shape',
      icon: shape.icon,
      label: shape.label,
      description: shape.description,
      group: shape.group,
      source: shape.content?.source,
      editRoute: shape.content?.editRoute,
      capabilities: shape.capabilities,
    })
  })
})

describe('toolLessRowSource (goal 0237 S3 rider)', () => {
  it('normalizes a tool-less noun into a row, with no group chip and its own disableScopeNote', () => {
    const diagram = toolLessNounExtensions().find((e) => e.kind === 'diagram')!
    const row = toolLessRowSource(diagram)
    expect(row).toEqual({
      id: 'diagram',
      icon: diagram.extension.icon,
      label: diagram.extension.label,
      description: diagram.extension.description,
      source: diagram.content.source,
      editRoute: diagram.content.editRoute,
      capabilities: diagram.extension.capabilities,
      disableScopeNote: diagram.extension.disableScopeNote,
    })
    expect(row.group).toBeUndefined()
  })
})
