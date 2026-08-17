import { Checkbox, FormControl, Select, Text, TextInput, Textarea } from '@primer/react'
import { Type as ConfigFieldType } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import type { Field } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import runbookStyles from '../shared/ListCard.module.css'

// A card's Fields, rendered against its Kind's declared schema -- the
// same typedfield.Field vocabulary/switch-on-Type shape
// composition/NodeConfigFields.tsx already established for a NodeType's
// ConfigFields (boolean/options/number/multiline/text), reused here at
// the type level rather than duplicated by hand: a card's fields carry
// no RefKind/Suggestions today (atlas.Kind.Fields never declares
// either -- see internal/domain/atlas/builtin.go's seeded examples), so
// this only needs the plain-value branches, not the Configure-entity
// picker or suggestion-list branches NodeConfigFields also renders.
//
// Read-is-edit (goal 0081 slice A5): onChange updates the live draft on
// every keystroke/selection; onCommit is the SAVE trigger, fired at the
// point that matches each control's own interaction model -- a
// discrete choice (boolean/options) commits the instant it changes,
// continuous typing (text/number/multiline) commits on blur so a save
// request isn't fired per keystroke. The boolean/options branches pass
// the new value to onCommit directly rather than reading it back off
// `values` in the same handler -- testing.md's stale-setState trap: a
// setState call and a same-tick read of the state it set race, since
// React hasn't re-rendered yet.
export function AtlasFieldsForm({ fields, values, onChange, onCommit, errors, readOnly = false }: {
  fields: Field[]
  values: Record<string, string>
  onChange: (key: string, value: string) => void
  onCommit?: (key: string, value: string) => void
  errors?: Record<string, string>
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
              onChange={(e) => {
                const next = String(e.target.checked)
                onChange(field.Key, next)
                onCommit?.(field.Key, next)
              }}
            />
          ) : field.Type === ConfigFieldType.TypeOptions ? (
            <Select
              value={values[field.Key] ?? ''}
              data-testid="atlas-field"
              onChange={(e) => {
                const next = e.target.value
                onChange(field.Key, next)
                onCommit?.(field.Key, next)
              }}
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
              onBlur={() => onCommit?.(field.Key, values[field.Key] ?? '')}
            />
          ) : field.Multiline ? (
            <Textarea
              value={values[field.Key] ?? ''}
              rows={4}
              block
              data-testid="atlas-field"
              onChange={(e) => onChange(field.Key, e.target.value)}
              onBlur={() => onCommit?.(field.Key, values[field.Key] ?? '')}
            />
          ) : (
            <TextInput
              value={values[field.Key] ?? ''}
              block
              data-testid="atlas-field"
              onChange={(e) => onChange(field.Key, e.target.value)}
              onBlur={() => onCommit?.(field.Key, values[field.Key] ?? '')}
            />
          )}
          {errors?.[field.Key] && (
            <Text as="p" size="small" className={runbookStyles.error} data-testid="atlas-field-error">{errors[field.Key]}</Text>
          )}
        </FormControl>
      ))}
    </>
  )
}
