import { describe, expect, it } from 'vitest'
import { editRouteLabel, groupLabel, sourceLabel } from './extensionMeta'

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
