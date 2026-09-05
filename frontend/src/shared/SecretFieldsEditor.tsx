import { useTranslation } from 'react-i18next'
import { Button, FormControl, IconButton, Stack, TextInput } from '@primer/react'
import { EyeClosedIcon, EyeIcon, PlusIcon, TrashIcon } from '@primer/octicons-react'
import type { Field } from '../../bindings/github.com/alicoding/mill/internal/domain/secret/models'

// The entry's own fields (goal 0306 S4): a name, a value, and whether
// the value stays hidden until asked for. Its own component so the
// entry dialog stays one readable flow, and so the row's three
// controls have one place to change.

export function SecretFieldsEditor({ fields, setFields }: {
  fields: Field[]
  setFields: (next: Field[]) => void
}) {
  const { t } = useTranslation('secrets')
  const update = (index: number, patch: Partial<Field>) => {
    setFields(fields.map((f, i) => (i === index ? { ...f, ...patch } : f)))
  }
  return (
    <FormControl>
      <FormControl.Label>{t('fields.customFields')}</FormControl.Label>
      <Stack direction="vertical" gap="condensed">
        {fields.map((field, index) => (
          <Stack key={index} direction="horizontal" gap="condensed" align="center">
            <TextInput
              value={field.Name}
              onChange={(e) => update(index, { Name: e.target.value })}
              aria-label={t('fields.fieldName')}
              placeholder={t('fields.fieldName')}
              data-testid={`secret-field-name-${index}`}
            />
            <TextInput
              value={field.Value}
              type={field.Protected ? 'password' : 'text'}
              onChange={(e) => update(index, { Value: e.target.value })}
              aria-label={t('fields.fieldValue')}
              placeholder={t('fields.fieldValue')}
              block
              data-testid={`secret-field-value-${index}`}
            />
            <IconButton
              icon={field.Protected ? EyeClosedIcon : EyeIcon}
              aria-label={field.Protected ? t('fields.showValue') : t('fields.hideValue')}
              size="small"
              variant="invisible"
              onClick={() => update(index, { Protected: !field.Protected })}
              data-testid={`secret-field-hide-${index}`}
            />
            <IconButton
              icon={TrashIcon}
              aria-label={t('fields.removeField')}
              size="small"
              variant="invisible"
              onClick={() => setFields(fields.filter((_, i) => i !== index))}
              data-testid={`secret-field-remove-${index}`}
            />
          </Stack>
        ))}
        <Stack.Item>
          <Button
            size="small"
            leadingVisual={PlusIcon}
            onClick={() => setFields([...fields, { Name: '', Value: '', Protected: false }])}
            data-testid="secret-field-add"
          >
            {t('fields.addField')}
          </Button>
        </Stack.Item>
      </Stack>
    </FormControl>
  )
}
