import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Checkbox, FormControl, IconButton, Select, Stack, TextInput } from '@primer/react'
import { TrashIcon } from '@primer/octicons-react'
import type { Field } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import { Type as ConfigFieldType } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import type { Row } from '../../bindings/github.com/alicoding/mill/internal/domain/list/models'
import { RowStatus } from '../../bindings/github.com/alicoding/mill/internal/domain/list/models'
import styles from '../shared/ListCard.module.css'

// One row's inline editor -- a type-aware input per declared Column
// (text/number/boolean; TypeOptions renders a Select over the
// column's own Options, same as ConfigField's generic Inspector
// rendering elsewhere) plus an Active/Expired status Select. Local
// draft state with an explicit Save, rather than per-keystroke RPCs.
// Split out of ConfigureLists.tsx once that file crossed the 500-line
// convention -- a self-contained sub-component with no state shared
// back to its parent beyond onSave/onDelete.
export function ListRowEditor({ row, columns, onSave, onDelete }: {
  row: Row
  columns: Field[]
  onSave: (values: Record<string, string>, status: RowStatus) => void
  onDelete: () => void
}) {
  const { t } = useTranslation('configure')
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(row.Values ?? {}).map(([k, v]) => [k, v ?? ''])),
  )
  const [status, setStatus] = useState<RowStatus>(row.Status)

  const setValue = (key: string, v: string) => setValues((prev) => ({ ...prev, [key]: v }))

  return (
    <Stack direction="vertical" gap="condensed" className={styles.card} data-testid="list-row">
      <Stack direction="horizontal" gap="condensed" wrap="wrap" align="center">
        {columns.map((c) => (
          <FormControl key={c.Key}>
            <FormControl.Label visuallyHidden>{c.Label || c.Key}</FormControl.Label>
            {c.Type === ConfigFieldType.TypeBoolean ? (
              <Checkbox
                checked={values[c.Key] === 'true'}
                aria-label={c.Label || c.Key}
                onChange={(e) => setValue(c.Key, String(e.target.checked))}
              />
            ) : c.Type === ConfigFieldType.TypeOptions ? (
              <Select aria-label={c.Label || c.Key} value={values[c.Key] ?? ''} onChange={(e) => setValue(c.Key, e.target.value)}>
                <Select.Option value="">{t('configureLists.unset')}</Select.Option>
                {(c.Options ?? []).map((opt) => (
                  <Select.Option key={opt} value={opt}>{opt}</Select.Option>
                ))}
              </Select>
            ) : (
              <TextInput
                type={c.Type === ConfigFieldType.TypeNumber ? 'number' : 'text'}
                placeholder={c.Label || c.Key}
                aria-label={c.Label || c.Key}
                value={values[c.Key] ?? ''}
                onChange={(e) => setValue(c.Key, e.target.value)}
              />
            )}
          </FormControl>
        ))}
        <Select aria-label={t('configureLists.rowStatusAriaLabel')} value={status} onChange={(e) => setStatus(e.target.value as RowStatus)} data-testid="list-row-status">
          <Select.Option value={RowStatus.RowActive}>{t('configureLists.active')}</Select.Option>
          <Select.Option value={RowStatus.RowExpired}>{t('configureLists.expired')}</Select.Option>
        </Select>
        <Button size="small" onClick={() => onSave(values, status)} data-testid="save-list-row">{t('configureLists.save')}</Button>
        <IconButton icon={TrashIcon} aria-label={t('configureLists.deleteRowAriaLabel')} size="small" variant="invisible" onClick={onDelete} />
      </Stack>
    </Stack>
  )
}
