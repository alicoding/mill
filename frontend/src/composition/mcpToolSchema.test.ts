import { describe, expect, it } from 'vitest'
import { parseToolInputSchema } from './mcpToolSchema'

describe('parseToolInputSchema', () => {
  it('maps a string property to type string', () => {
    const fields = parseToolInputSchema({ type: 'object', properties: { name: { type: 'string' } } })
    expect(fields).toEqual([{ name: 'name', type: 'string', required: false }])
  })

  it('maps a string property with an enum to type enum, carrying enumValues', () => {
    const fields = parseToolInputSchema({
      type: 'object',
      properties: { color: { type: 'string', enum: ['red', 'green', 'blue'] } },
    })
    expect(fields).toEqual([{ name: 'color', type: 'enum', required: false, enumValues: ['red', 'green', 'blue'] }])
  })

  it('maps number and integer properties to type number', () => {
    const fields = parseToolInputSchema({
      type: 'object',
      properties: { count: { type: 'number' }, page: { type: 'integer' } },
    })
    expect(fields.find((f) => f.name === 'count')?.type).toBe('number')
    expect(fields.find((f) => f.name === 'page')?.type).toBe('number')
  })

  it('maps a boolean property to type boolean', () => {
    const fields = parseToolInputSchema({ type: 'object', properties: { loud: { type: 'boolean' } } })
    expect(fields).toEqual([{ name: 'loud', type: 'boolean', required: false }])
  })

  it('maps object and array properties (and anything else) to type json', () => {
    const fields = parseToolInputSchema({
      type: 'object',
      properties: { meta: { type: 'object' }, tags: { type: 'array' }, whatever: {} },
    })
    expect(fields.find((f) => f.name === 'meta')?.type).toBe('json')
    expect(fields.find((f) => f.name === 'tags')?.type).toBe('json')
    expect(fields.find((f) => f.name === 'whatever')?.type).toBe('json')
  })

  it('carries the required flag from the schema-level required array', () => {
    const fields = parseToolInputSchema({
      type: 'object',
      properties: { name: { type: 'string' }, nickname: { type: 'string' } },
      required: ['name'],
    })
    expect(fields.find((f) => f.name === 'name')?.required).toBe(true)
    expect(fields.find((f) => f.name === 'nickname')?.required).toBe(false)
  })

  it('carries a field description when present', () => {
    const fields = parseToolInputSchema({
      type: 'object',
      properties: { name: { type: 'string', description: 'Who to greet' } },
    })
    expect(fields[0].description).toBe('Who to greet')
  })

  it('is tolerant of a non-object schema', () => {
    expect(parseToolInputSchema(null)).toEqual([])
    expect(parseToolInputSchema(undefined)).toEqual([])
    expect(parseToolInputSchema('not a schema')).toEqual([])
    expect(parseToolInputSchema(42)).toEqual([])
  })

  it('is tolerant of a schema with no properties', () => {
    expect(parseToolInputSchema({})).toEqual([])
    expect(parseToolInputSchema({ type: 'object' })).toEqual([])
    expect(parseToolInputSchema({ type: 'object', properties: null })).toEqual([])
  })

  it('never throws on a malformed required list', () => {
    expect(() =>
      parseToolInputSchema({ type: 'object', properties: { a: { type: 'string' } }, required: 'not-an-array' }),
    ).not.toThrow()
  })
})
