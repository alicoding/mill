import { describe, expect, it } from 'vitest'
import type { ManualField } from './openapiSynth'
import { generateOperationSample } from './testPayload'

function field(name: string, type: ManualField['type']): ManualField {
  return { name, in: 'body', type, required: false, secret: false }
}

describe('generateOperationSample', () => {
  it('generates one stringified value per declared field, typed correctly', () => {
    const fields = [field('id', 'string'), field('count', 'integer'), field('rate', 'number'), field('active', 'boolean')]
    const sample = generateOperationSample(fields)
    expect(Object.keys(sample).sort()).toEqual(['active', 'count', 'id', 'rate'])
    expect(['true', 'false']).toContain(sample.active)
    expect(Number.isNaN(Number(sample.count))).toBe(false)
    expect(Number.isNaN(Number(sample.rate))).toBe(false)
    expect(typeof sample.id).toBe('string')
  })

  it('falls back to a plain string for object/array fields (no nested-fake generation)', () => {
    const fields = [field('meta', 'object'), field('tags', 'array')]
    const sample = generateOperationSample(fields)
    expect(typeof sample.meta).toBe('string')
    expect(typeof sample.tags).toBe('string')
  })
})
