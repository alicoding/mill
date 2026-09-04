import { describe, expect, it } from 'vitest'
import { menuForDeclaredCommand } from './hostApi'
import type { Manifest } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'

function manifestWith(commands: Manifest['contributes']['commands']): Manifest {
  return {
    id: 'mill-index', name: 'Board index', version: '1.0.0', description: '', author: '', minMillVersion: '0.9.0', icon: 'icon.png',
    capabilities: [], contributes: { canvasObjects: [], steps: [], captures: [], settings: [], network: [], views: [], commands, tools: [] },
  }
}

describe('menuForDeclaredCommand (goal 0335: the manifest -> registerCommand menu join)', () => {
  it('maps a declared menu seat onto Command.menu, joined by id', () => {
    const manifest = manifestWith([{ id: 'mill-index.refresh', label: 'Refresh the board index', menu: { path: 'help', group: 1, order: 2 } }])
    expect(menuForDeclaredCommand(manifest, 'mill-index.refresh')).toEqual({ path: 'help', group: 1, order: 2 })
  })

  it('is undefined for a declared command with no menu field', () => {
    const manifest = manifestWith([{ id: 'mill-index.refresh', label: 'Refresh the board index' }])
    expect(menuForDeclaredCommand(manifest, 'mill-index.refresh')).toBeUndefined()
  })

  it('is undefined for a command id the manifest never declared', () => {
    const manifest = manifestWith([])
    expect(menuForDeclaredCommand(manifest, 'mill-index.refresh')).toBeUndefined()
  })
})
