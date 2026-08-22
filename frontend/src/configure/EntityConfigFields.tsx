import { Checkbox, FormControl, Select, Textarea, TextInput } from '@primer/react'
import type { Field } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import { Type as FieldType } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import { EntityRefField } from './EntityRefField'

export interface EntityConfigFieldsProps {
  fields: Field[]
  values: Record<string, string>
  onChange: (key: string, value: string) => void
  // Per-field placeholder text -- typedfield.Field has no Placeholder
  // facet (unlike Description, which drives the caption below), so a
  // caller that needs one supplies it here rather than the generic
  // renderer inventing per-entity text.
  placeholders?: Record<string, string>
  // Overrides the caption a field renders below its label, in place of
  // field.Description -- for a caption that depends on another field's
  // current value (e.g. AI Provider's Base URL caption following the
  // selected Kind), which a static Field can't express.
  captionOverrides?: Record<string, React.ReactNode>
  // Per-option display text for a TypeOptions field, keyed by field Key
  // then by the option's own wire value -- typedfield.Field's Options
  // carry only the wire value, no separate display label (unlike
  // OptionColors, which pairs a presentation facet by index, no
  // equivalent exists for label text). Falls back to the wire value
  // when unset.
  optionLabels?: Record<string, Record<string, string>>
  // Per-field data-testid override, for a field an existing e2e spec
  // already addresses by a stable id (e.g. AI Provider's Kind select).
  testIds?: Record<string, string>
}

// The generic Configure-entity field renderer (docs/adr/0166): a
// sibling to composition/NodeConfigFields.tsx, following the same
// descriptor-driven switch on Type/RefKind/Multiline and reusing the
// same EntityRefField -- but fully controlled (value+onChange, not
// NodeConfigFields' defaultValue+onBlur), matching how a Configure
// entity form already behaves: every keystroke updates its Save-button-
// gated draft immediately, not on blur.
export function EntityConfigFields({ fields, values, onChange, placeholders, captionOverrides, optionLabels, testIds }: EntityConfigFieldsProps) {
  return (
    <>
      {fields.map((field) => {
        const caption = captionOverrides?.[field.Key] ?? field.Description
        const testId = testIds?.[field.Key]
        const value = values[field.Key] ?? ''
        return (
          <FormControl key={field.Key}>
            <FormControl.Label>{field.Label}</FormControl.Label>
            {caption && <FormControl.Caption>{caption}</FormControl.Caption>}
            {field.RefKind ? (
              <EntityRefField refKind={field.RefKind} value={value} onChange={(id) => onChange(field.Key, id)} />
            ) : field.Type === FieldType.TypeBoolean ? (
              <Checkbox checked={value === 'true'} data-testid={testId} onChange={(e) => onChange(field.Key, String(e.target.checked))} />
            ) : field.Type === FieldType.TypeOptions ? (
              <Select value={value} data-testid={testId} onChange={(e) => onChange(field.Key, e.target.value)}>
                {(field.Options ?? []).map((opt) => (
                  <Select.Option key={opt} value={opt}>{optionLabels?.[field.Key]?.[opt] ?? opt}</Select.Option>
                ))}
              </Select>
            ) : field.Multiline ? (
              <Textarea value={value} rows={4} block data-testid={testId} onChange={(e) => onChange(field.Key, e.target.value)} />
            ) : (
              <TextInput
                value={value}
                type={field.Secret ? 'password' : 'text'}
                placeholder={placeholders?.[field.Key]}
                block
                data-testid={testId}
                onChange={(e) => onChange(field.Key, e.target.value)}
              />
            )}
          </FormControl>
        )
      })}
    </>
  )
}
