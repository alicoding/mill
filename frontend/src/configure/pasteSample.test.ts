import { describe, expect, it } from 'vitest'
import { inferFieldsFromSample } from './pasteSample'
import configure from '../locales/en/configure.json'

// A minimal stand-in for react-i18next's t() -- same pattern
// composition/validationCopy.test.ts uses, resolving the real English
// strings from configure.json rather than pulling react-i18next's
// provider/hook machinery into a non-component test.
function t(key: string): string {
  const value = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], configure)
  if (typeof value !== 'string') throw new Error(`missing configure.json key: ${key}`)
  return value
}

describe('inferFieldsFromSample', () => {
  it('infers a body field per top-level key, typed from the sample value', () => {
    const { fields, error } = inferFieldsFromSample(t, JSON.stringify({
      name: 'Ada', age: 36, active: true, score: 4.5, tags: ['a', 'b'], meta: { x: 1 },
    }))
    expect(error).toBe('')
    const byName = Object.fromEntries(fields.map((f) => [f.name, f]))
    expect(byName.name).toMatchObject({ in: 'body', type: 'string' })
    expect(byName.age).toMatchObject({ type: 'integer' })
    expect(byName.active).toMatchObject({ type: 'boolean' })
    expect(byName.score).toMatchObject({ type: 'number' })
    expect(byName.tags).toMatchObject({ type: 'array' })
    expect(byName.meta).toMatchObject({ type: 'object' })
  })

  it('rejects invalid JSON with a clear error, not a throw', () => {
    const { fields, error } = inferFieldsFromSample(t, 'not json')
    expect(fields).toEqual([])
    expect(error).not.toBe('')
  })

  it('rejects a non-object top-level value (array or bare scalar)', () => {
    expect(inferFieldsFromSample(t, '[1,2,3]').error).not.toBe('')
    expect(inferFieldsFromSample(t, '"just a string"').error).not.toBe('')
  })
})
