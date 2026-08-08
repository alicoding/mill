import { describe, expect, it } from 'vitest'
import { ConfigFieldType } from '../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { configFieldsToZodSchema, generateSamplePayload, type TypedField } from './configSchema'

// docs/adr/0008's test-input form generalizes this module from a
// NodeType's ConfigField[] to a Workflow's AttributeDef[] -- AttributeDef
// has no Options field at all (§3.3's rule-builder Update note), so the
// real risk this generalization introduces is a FieldOptions field with
// undefined Options blowing up schema construction, and every generated
// value round-tripping back to a string the way Node.Config/runInput.Values
// both require on the wire.
describe('configFieldsToZodSchema / generateSamplePayload with AttributeDef-shaped input', () => {
  const attributeLikeFields: TypedField[] = [
    { Key: 'urgent', Type: ConfigFieldType.FieldBoolean },
    { Key: 'retryCount', Type: ConfigFieldType.FieldNumber },
    { Key: 'label', Type: ConfigFieldType.FieldText },
  ]

  it('builds a valid schema with no Options field present (AttributeDef never declares one)', () => {
    expect(() => configFieldsToZodSchema(attributeLikeFields)).not.toThrow()
  })

  it('generates one stringified value per declared key, typed correctly', () => {
    const sample = generateSamplePayload(attributeLikeFields)
    expect(Object.keys(sample).sort()).toEqual(['label', 'retryCount', 'urgent'])
    expect(['true', 'false']).toContain(sample.urgent)
    expect(Number.isNaN(Number(sample.retryCount))).toBe(false)
    expect(typeof sample.label).toBe('string')
  })

  it('falls back to a plain string for a FieldOptions field with no Options list', () => {
    const fields: TypedField[] = [{ Key: 'choice', Type: ConfigFieldType.FieldOptions }]
    const sample = generateSamplePayload(fields)
    expect(typeof sample.choice).toBe('string')
  })
})
