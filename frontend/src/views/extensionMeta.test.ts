import { describe, expect, it } from 'vitest'
import { ATLAS_TOOLS } from '../atlas/atlasTools'
import { toolLessNounExtensions } from '../atlas/atlasNounRegistry'
import {
  descriptionLabel, editRouteLabel, groupLabel, groupSectionLabel, reachLabel, sourceLabel, versionLabel,
  toolLessRowSource, toolRowSource, extensionRowPadY, extensionRowHeight,
} from './extensionMeta'

describe('groupLabel', () => {
  it('maps every declared group to user-facing text', () => {
    expect(groupLabel('knowledge')).toBe('Knowledge')
    expect(groupLabel('file')).toBe('File')
    expect(groupLabel('annotate')).toBe('Drawing')
  })
})

describe('groupSectionLabel', () => {
  it('maps every declared group to its section-heading text, plural where the chip is singular', () => {
    expect(groupSectionLabel('knowledge')).toBe('Knowledge')
    expect(groupSectionLabel('file')).toBe('Files')
    expect(groupSectionLabel('annotate')).toBe('Drawing')
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
  it('normalizes a tray tool into a row, reading nounName (not the command-verb label) for the title', () => {
    const image = ATLAS_TOOLS.find((t) => t.id === 'image')!
    const row = toolRowSource(image)
    expect(row).toEqual({
      id: 'image',
      icon: image.icon,
      label: image.nounName,
      commandLabel: image.label,
      description: image.description,
      group: image.group,
      source: image.content?.source,
      editRoute: image.content?.editRoute,
      capabilities: image.capabilities,
    })
    expect(row.label).toBe('Image')
    // The verb phrase stays available for the detail pane's "What it
    // adds" -- it is just never the row title.
    expect(row.commandLabel).toBe('Add an image')
  })
})

describe('toolLessRowSource (goal 0237 S3 rider)', () => {
  it('normalizes a tool-less noun into a row, carrying its own group and disableScopeNote', () => {
    const diagram = toolLessNounExtensions().find((e) => e.kind === 'diagram')!
    const row = toolLessRowSource(diagram)
    expect(row).toEqual({
      id: 'diagram',
      icon: diagram.extension.icon,
      label: diagram.extension.label,
      description: diagram.extension.description,
      group: diagram.extension.group,
      source: diagram.content.source,
      editRoute: diagram.content.editRoute,
      capabilities: diagram.extension.capabilities,
      disableScopeNote: diagram.extension.disableScopeNote,
    })
    expect(row.group).toBe('file')
  })
})

// Row geometry (goal 0321): the Extensions list follows display
// density directly. The mapping lives in JS so it has ONE source; this
// pins both ends of it, including the Compact floor -- the raw Compact
// token (2px) leaves a row shorter than the 16px icon it carries.
describe('extension row density (goal 0321)', () => {
  it('maps each density to its own padding and row height', () => {
    expect(extensionRowPadY('comfortable')).toBe(12)
    expect(extensionRowPadY('compact')).toBe(6)
    expect(extensionRowHeight('comfortable')).toBe(44)
    expect(extensionRowHeight('compact')).toBe(32)
  })

  it('always leaves a Compact row shorter than a Comfortable one', () => {
    expect(extensionRowHeight('compact')).toBeLessThan(extensionRowHeight('comfortable'))
  })
})
