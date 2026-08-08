import { describe, expect, it } from 'vitest'
import { inferFieldsFromSample } from './pasteSample'

describe('inferFieldsFromSample', () => {
  it('infers a body field per top-level key, typed from the sample value', () => {
    const { fields, error } = inferFieldsFromSample(JSON.stringify({
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
    const { fields, error } = inferFieldsFromSample('not json')
    expect(fields).toEqual([])
    expect(error).not.toBe('')
  })

  it('rejects a non-object top-level value (array or bare scalar)', () => {
    expect(inferFieldsFromSample('[1,2,3]').error).not.toBe('')
    expect(inferFieldsFromSample('"just a string"').error).not.toBe('')
  })
})
