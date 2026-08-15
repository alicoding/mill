import { useTranslation } from 'react-i18next'
import { Checkbox, FormControl, Select, Stack, Text, TextInput, Textarea } from '@primer/react'
import type { ConfigField } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { Type as ConfigFieldType } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import styles from '../shared/ListCard.module.css'

export interface PinnedFieldsState {
  pinnedConfig: Record<string, string>
  hiddenFields: string[]
}

// The step designer's "pin a value, or leave it free" half of the form
// (ADR-0037's Consequences: "pick an engine binding, name it, optionally
// pin fields"). Lists the underlying engine's own ConfigFields (minus
// its binding field(s), which the designer's binding step above already
// covers and the server always force-hides) with one checkbox each:
// checked pins the field's current value into PinnedConfig AND adds it
// to HiddenFields (locked, dropped from the palette view entirely for
// every node dropped from this step type -- declaredsteptype.go's own
// PinnedConfig/HiddenFields doc comments); unchecked leaves it free for
// each workflow author to fill in per node, same as any ordinary
// ConfigField. Renders one typed control per field.Type, the same
// switch NodeConfigFields.tsx's generic ConfigField loop already
// establishes, narrowed to the types these three engines' own
// non-binding fields actually use (text/multiline/options) --
// RefKind-carrying fields never reach here since bindingFieldKeysFor
// already excludes every field this engine's binding step owns.
export function StepTypePinnedFieldsEditor({ fields, state, onChange }: {
  fields: ConfigField[]
  state: PinnedFieldsState
  onChange: (next: PinnedFieldsState) => void
}) {
  const { t } = useTranslation('configure')

  if (fields.length === 0) {
    return <Text as="p" size="small" className={styles.muted}>{t('configureStepTypes.noPinnableFields')}</Text>
  }

  const setPinned = (key: string, pinned: boolean, value: string) => {
    const nextConfig = { ...state.pinnedConfig }
    const nextHidden = state.hiddenFields.filter((k) => k !== key)
    if (pinned) {
      nextConfig[key] = value
      nextHidden.push(key)
    } else {
      delete nextConfig[key]
    }
    onChange({ pinnedConfig: nextConfig, hiddenFields: nextHidden })
  }

  return (
    <Stack direction="vertical" gap="condensed">
      {fields.map((field) => {
        const pinned = state.hiddenFields.includes(field.Key)
        const value = state.pinnedConfig[field.Key] ?? field.Default ?? ''
        return (
          <FormControl key={field.Key}>
            <Checkbox
              checked={pinned}
              data-testid="steptype-pin-toggle"
              onChange={(e) => setPinned(field.Key, e.target.checked, value)}
            />
            <FormControl.Label>{t('configureStepTypes.pinField', { label: field.Label })}</FormControl.Label>
            {field.Description && <FormControl.Caption>{field.Description}</FormControl.Caption>}
            {pinned && (
              field.Type === ConfigFieldType.TypeBoolean ? (
                <Checkbox
                  checked={value === 'true'}
                  aria-label={field.Label}
                  data-testid="steptype-pin-value"
                  onChange={(e) => setPinned(field.Key, true, String(e.target.checked))}
                />
              ) : field.Type === ConfigFieldType.TypeOptions ? (
                <Select
                  value={value}
                  aria-label={field.Label}
                  data-testid="steptype-pin-value"
                  onChange={(e) => setPinned(field.Key, true, e.target.value)}
                >
                  {(field.Options ?? []).map((opt) => (
                    <Select.Option key={opt} value={opt}>{opt}</Select.Option>
                  ))}
                </Select>
              ) : field.Multiline ? (
                <Textarea
                  defaultValue={value}
                  rows={4}
                  block
                  aria-label={field.Label}
                  data-testid="steptype-pin-value"
                  onBlur={(e) => setPinned(field.Key, true, e.target.value)}
                />
              ) : (
                <TextInput
                  defaultValue={value}
                  block
                  aria-label={field.Label}
                  data-testid="steptype-pin-value"
                  onBlur={(e) => setPinned(field.Key, true, e.target.value)}
                />
              )
            )}
          </FormControl>
        )
      })}
    </Stack>
  )
}
