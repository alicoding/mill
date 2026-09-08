import { describe, expect, it } from 'vitest'
import { normalizeAtlasBoardView, parsePluginBoardView } from './viewKinds'

// The legacy-literal -> plugin-pane migration table (goal 0357 S2):
// every core projection that moved out to a bundled plugin (Roadmap
// in S1, Matrix and Coverage in S2) leaves behind a persisted literal
// this read-side mapping must still resolve, so a window that last
// saved before the move lands on the plugin's own pane instead of a
// blank fallback.
describe('normalizeAtlasBoardView', () => {
  it('migrates every legacy core-projection literal onto its bundled plugin pane', () => {
    expect(normalizeAtlasBoardView('roadmap')).toBe('plugin:mill-roadmap.roadmap')
    expect(normalizeAtlasBoardView('matrix')).toBe('plugin:mill-matrix.matrix')
    expect(normalizeAtlasBoardView('coverage')).toBe('plugin:mill-coverage.coverage')
  })

  it('leaves the still-core List view and an already-migrated plugin id untouched', () => {
    expect(normalizeAtlasBoardView('list')).toBe('list')
    expect(normalizeAtlasBoardView('plugin:mill-matrix.matrix')).toBe('plugin:mill-matrix.matrix')
  })

  it('falls back to the Board for an unknown or missing value', () => {
    expect(normalizeAtlasBoardView(undefined)).toBe('board')
    expect(normalizeAtlasBoardView('some-removed-view')).toBe('board')
  })
})

describe('parsePluginBoardView', () => {
  it('splits a migrated plugin view id into its plugin and view parts', () => {
    expect(parsePluginBoardView('plugin:mill-matrix.matrix')).toEqual({ pluginId: 'mill-matrix', viewId: 'matrix' })
  })

  it('is null for a core view', () => {
    expect(parsePluginBoardView('board')).toBeNull()
    expect(parsePluginBoardView('list')).toBeNull()
  })
})
