import { describe, expect, it } from 'vitest'
import { mergeAtlasLocaleModules } from './atlasLocaleMerge'

describe('mergeAtlasLocaleModules', () => {
  it('merges disjoint top-level keys from separate files into one object', () => {
    const merged = mergeAtlasLocaleModules({
      'pencil.json': { pencilStyle: { colorLabel: 'Stroke colour' } },
      'shape.json': { shapeStyle: { strokeLabel: 'Stroke colour' } },
    })
    expect(merged).toEqual({
      pencilStyle: { colorLabel: 'Stroke colour' },
      shapeStyle: { strokeLabel: 'Stroke colour' },
    })
  })

  it('throws, naming both files, when two files declare the same top-level key', () => {
    expect(() =>
      mergeAtlasLocaleModules({
        'shape.json': { shapeStyle: { strokeLabel: 'Stroke colour' } },
        'pencil.json': { shapeStyle: { colorLabel: 'Duplicate' } },
      }),
    ).toThrowError(/atlas locale key "shapeStyle" is declared in both pencil\.json and shape\.json/)
  })

  it('throws even when the colliding key is a plain string value, not just a nested object', () => {
    expect(() =>
      mergeAtlasLocaleModules({
        'a.json': { shared: 'x' },
        'b.json': { shared: 'y', bOnly: 'z' },
      }),
    ).toThrow(/atlas locale key "shared" is declared in both/)
  })
})
