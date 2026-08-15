import { Checkbox, FormControl, Select, TextInput, Textarea } from '@primer/react'
import { Type as ConfigFieldType } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import type { Field } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'

// A card's Fields, rendered against its Kind's declared schema -- the
// same typedfield.Field vocabulary/switch-on-Type shape
// composition/NodeConfigFields.tsx already established for a NodeType's
// ConfigFields (boolean/options/number/multiline/text), reused here at
// the type level rather than duplicated by hand: a card's fields carry
// no RefKind/Suggestions today (atlas.Kind.Fields never declares
// either -- see internal/domain/atlas/builtin.go's seeded examples), so
// this only needs the plain-value branches, not the Configure-entity
// picker or suggestion-list branches NodeConfigFields also renders.
export function AtlasFieldsForm({ fields, values, onChange, readOnly = false }: {
  fields: Field[]
  values: Record<string, string>
  onChange: (key: string, value: string) => void
  readOnly?: boolean
}) {
  if (fields.length === 0) return null
  return (
    <>
      {fields.map((field) => (
        <FormControl key={field.Key} disabled={readOnly}>
          <FormControl.Label>{field.Label}</FormControl.Label>
          {field.Description && <FormControl.Caption>{field.Description}</FormControl.Caption>}
          {field.Type === ConfigFieldType.TypeBoolean ? (
            <Checkbox
              checked={values[field.Key] === 'true'}
              data-testid="atlas-field"
              onChange={(e) => onChange(field.Key, String(e.target.checked))}
            />
          ) : field.Type === ConfigFieldType.TypeOptions ? (
            <Select
              value={values[field.Key] ?? ''}
              data-testid="atlas-field"
              onChange={(e) => onChange(field.Key, e.target.value)}
            >
              {(field.Options ?? []).map((opt) => (
                <Select.Option key={opt} value={opt}>{opt}</Select.Option>
              ))}
            </Select>
          ) : field.Type === ConfigFieldType.TypeNumber ? (
            <TextInput
              type="number"
              value={values[field.Key] ?? ''}
              block
              data-testid="atlas-field"
              onChange={(e) => onChange(field.Key, e.target.value)}
            />
          ) : field.Multiline ? (
            <Textarea
              value={values[field.Key] ?? ''}
              rows={4}
              block
              data-testid="atlas-field"
              onChange={(e) => onChange(field.Key, e.target.value)}
            />
          ) : (
            <TextInput
              value={values[field.Key] ?? ''}
              block
              data-testid="atlas-field"
              onChange={(e) => onChange(field.Key, e.target.value)}
            />
          )}
        </FormControl>
      ))}
    </>
  )
}
