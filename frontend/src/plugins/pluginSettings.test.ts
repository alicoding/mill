import { describe, expect, it } from 'vitest'
import type { Manifest } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { settingDeclsFromManifest } from './pluginSettings'

function manifestWith(settings: unknown): Manifest {
  return { id: 'p', name: 'P', version: '1', description: '', author: '', minMillVersion: '', capabilities: [], contributes: { canvasObjects: [], settings } } as unknown as Manifest
}

describe('settingDeclsFromManifest', () => {
  it('maps every validated manifest type onto the noun declaration shape, `default` becoming defaultValue', () => {
    const decls = settingDeclsFromManifest(manifestWith([
      { key: 'flag', type: 'boolean', label: 'Flag', description: 'd', default: true },
      { key: 'title', type: 'string', label: 'Title', description: null, default: 'Hi' },
      { key: 'rows', type: 'number', label: 'Rows', description: '', default: 10, min: 1, max: 100 },
      { key: 'style', type: 'enum', label: 'Style', description: '', default: 'a', options: [{ value: 'a', label: 'A' }] },
    ]))
    expect(decls).toEqual([
      { key: 'flag', type: 'boolean', label: 'Flag', description: 'd', defaultValue: true },
      { key: 'title', type: 'string', label: 'Title', description: '', defaultValue: 'Hi' },
      { key: 'rows', type: 'number', label: 'Rows', description: '', defaultValue: 10, min: 1, max: 100 },
      { key: 'style', type: 'enum', label: 'Style', description: '', defaultValue: 'a', options: [{ value: 'a', label: 'A' }] },
    ])
  })

  it('a manifest without settings (or a null list from the binding) declares none', () => {
    expect(settingDeclsFromManifest(manifestWith(null))).toEqual([])
    expect(settingDeclsFromManifest(manifestWith(undefined))).toEqual([])
  })
})
