import { useTranslation } from 'react-i18next'
import { Button, FormControl, IconButton, Select, Stack, Text, TextInput } from '@primer/react'
import { PlusIcon, TrashIcon } from '@primer/octicons-react'
import { Type as ConfigFieldType } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import styles from '../shared/ListCard.module.css'

// process-ai-extract-structured's own output-field authoring surface
// (docs/goals/0031-ai-node-family.md) -- a dedicated editor, not a raw
// JSON textarea (node-standard item 1: "Typed ConfigFields, not raw
// JSON, wherever the shape is expressible"), same "own component for a
// structured, non-generic config shape" precedent
// DecisionOutcomeBindingsEditor.tsx/RulesetEditor.tsx already establish
// in this same package. Row shape mirrors ConfigureAttributes.tsx's own
// flat key/label/type editor -- the closest existing "author typed
// fields" surface -- plus Options for the Options type, since this
// node's own JSON-schema request honors an enum constraint
// (aiextractstructured.go's buildExtractSchema).

interface AIExtractField {
  Key: string
  Label: string
  Type: ConfigFieldType
  Options?: string[] | null
}

function typeLabelFor(t: (key: string) => string): Record<string, string> {
  return {
    [ConfigFieldType.TypeText]: t('aiExtractFieldsEditor.typeLabel.text'),
    [ConfigFieldType.TypeNumber]: t('aiExtractFieldsEditor.typeLabel.number'),
    [ConfigFieldType.TypeBoolean]: t('aiExtractFieldsEditor.typeLabel.boolean'),
    [ConfigFieldType.TypeOptions]: t('aiExtractFieldsEditor.typeLabel.options'),
  }
}

function parseFields(raw: string): AIExtractField[] {
  if (!raw.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function AIExtractFieldsEditor({ outputFieldsRaw, onChange }: {
  outputFieldsRaw: string
  onChange: (raw: string) => void
}) {
  const { t } = useTranslation('composition')
  const TYPE_LABEL = typeLabelFor(t)
  const fields = parseFields(outputFieldsRaw)
  const write = (next: AIExtractField[]) => onChange(JSON.stringify(next))

  return (
    <Stack direction="vertical" gap="condensed" data-testid="ai-extract-fields-editor">
      <Text size="small" weight="semibold">{t('aiExtractFieldsEditor.outputFields')}</Text>
      <Text size="small" as="p" className={styles.muted}>
        {t('aiExtractFieldsEditor.description')}
      </Text>
      {fields.map((f, i) => (
        <Stack key={i} direction="vertical" gap="condensed" className={styles.card}>
          <Stack direction="horizontal" gap="condensed" align="center">
            <TextInput
              size="small" placeholder={t('aiExtractFieldsEditor.keyPlaceholder')} value={f.Key} data-testid="ai-extract-field-key"
              onChange={(e) => write(fields.map((x, j) => (j === i ? { ...x, Key: e.target.value } : x)))}
            />
            <TextInput
              size="small" placeholder={t('aiExtractFieldsEditor.labelPlaceholder')} value={f.Label}
              onChange={(e) => write(fields.map((x, j) => (j === i ? { ...x, Label: e.target.value } : x)))}
            />
            <Select
              size="small" value={f.Type} data-testid="ai-extract-field-type"
              onChange={(e) => write(fields.map((x, j) => (j === i ? { ...x, Type: e.target.value as ConfigFieldType } : x)))}
            >
              {Object.entries(TYPE_LABEL).map(([v, l]) => (
                <Select.Option key={v} value={v}>{l}</Select.Option>
              ))}
            </Select>
            <IconButton
              icon={TrashIcon} aria-label={t('aiExtractFieldsEditor.removeFieldAriaLabel')} size="small" variant="invisible"
              onClick={() => write(fields.filter((_, j) => j !== i))}
            />
          </Stack>
          {f.Type === ConfigFieldType.TypeOptions && (
            <FormControl>
              <FormControl.Label>{t('aiExtractFieldsEditor.allowedValues')}</FormControl.Label>
              <TextInput
                size="small" block value={(f.Options ?? []).join(', ')}
                onChange={(e) => write(fields.map((x, j) => (j === i ? { ...x, Options: e.target.value.split(',').map((v) => v.trim()).filter(Boolean) } : x)))}
              />
            </FormControl>
          )}
        </Stack>
      ))}
      <Button
        size="small" leadingVisual={PlusIcon} data-testid="ai-extract-add-field"
        onClick={() => write([...fields, { Key: '', Label: '', Type: ConfigFieldType.TypeText }])}
      >
        {t('aiExtractFieldsEditor.addField')}
      </Button>
    </Stack>
  )
}
