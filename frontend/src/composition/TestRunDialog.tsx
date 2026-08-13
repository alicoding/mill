import { useTranslation } from 'react-i18next'
import { Checkbox, Dialog, FormControl, Stack, TextInput } from '@primer/react'
import { Type as ConfigFieldType } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import type { AttributeDef } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'

// The test-input form itself (docs/adr/0008, SPEC.md §3.2's per-record
// test harness): one field per declared Attribute, pre-filled via
// generateSamplePayload (CompositionView.tsx's run()), each still a
// normal editable input -- submit as-is for the common case, or
// override a specific value first. No workflow declares a FieldOptions
// Attribute today (ConfigureAttributes.tsx's own type picker doesn't
// offer it, docs/adr/0029 Phase 1), so unlike NodeInspector's ConfigField
// switch, there's no Select branch here -- every non-boolean/non-number
// field is plain text. Extracted from CompositionView.tsx (self-contained,
// no shared state with the parent beyond its own props) once that file
// crossed the 500-line limit adding workflow export/import.
export default function TestRunDialog({
  workflowLabel, attributes, values, onChange, onCancel, onRun,
  payloadHint, payload, onPayloadChange,
}: {
  workflowLabel: string
  attributes: AttributeDef[]
  values: Record<string, string>
  onChange: (key: string, value: string) => void
  onCancel: () => void
  onRun: () => void
  // Trigger-supplied-payload substitution (triggerPayload.ts): when the
  // workflow's trigger normally delivers the run's input (a
  // filesystem-watch path), a manual test run offers this field so the
  // run isn't dead-on-arrival with an empty payload -- the live failure
  // the owner hit running the saved-page seed. Absent hint = no field,
  // exactly the previous dialog.
  payloadHint?: string | null
  payload?: string
  onPayloadChange?: (value: string) => void
}) {
  const { t } = useTranslation('composition')
  return (
    <Dialog title={t('testRunDialog.title', { label: workflowLabel })} onClose={onCancel} footerButtons={[
      { content: t('testRunDialog.cancel'), onClick: onCancel },
      { content: t('testRunDialog.run'), buttonType: 'primary', onClick: onRun },
    ]}>
      <Stack direction="vertical" gap="normal">
        {payloadHint && onPayloadChange && (
          <FormControl>
            <FormControl.Label>{t('testRunDialog.initialPayload')}</FormControl.Label>
            <FormControl.Caption>{payloadHint}</FormControl.Caption>
            <TextInput
              value={payload ?? ''}
              block
              data-testid="test-run-payload"
              onChange={(e) => onPayloadChange(e.target.value)}
            />
          </FormControl>
        )}
        {attributes.map((attr) => (
          <FormControl key={attr.Key}>
            <FormControl.Label>{attr.Label}</FormControl.Label>
            {attr.Type === ConfigFieldType.TypeBoolean ? (
              <Checkbox
                checked={values[attr.Key] === 'true'}
                data-testid="test-run-field"
                onChange={(e) => onChange(attr.Key, String(e.target.checked))}
              />
            ) : attr.Type === ConfigFieldType.TypeNumber ? (
              <TextInput
                type="number"
                value={values[attr.Key] ?? ''}
                block
                data-testid="test-run-field"
                onChange={(e) => onChange(attr.Key, e.target.value)}
              />
            ) : (
              <TextInput
                value={values[attr.Key] ?? ''}
                block
                data-testid="test-run-field"
                onChange={(e) => onChange(attr.Key, e.target.value)}
              />
            )}
          </FormControl>
        ))}
      </Stack>
    </Dialog>
  )
}
