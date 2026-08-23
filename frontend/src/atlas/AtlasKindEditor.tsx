import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Checkbox, FormControl, IconButton, Select, Stack, Text, TextInput } from '@primer/react'
import { TrashIcon } from '@primer/octicons-react'
import type { Kind, LinkKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { Type as FieldType } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import type { Field, FieldTombstone } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import { AtlasService } from '../shared/bindings'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import runbookStyles from '../shared/ListCard.module.css'

// The five field types the card surface actually renders
// (AtlasFieldsForm) -- offering more here would author fields the
// page can only show as plain text. Exported so AtlasKindProposal.tsx
// (goal 0172 S2) offers this exact same set for a proposed field's own
// Type select, rather than a second hand-maintained list.
export const FIELD_TYPES: { value: FieldType; labelKey: string }[] = [
  { value: FieldType.TypeText, labelKey: 'kinds.fieldTypeText' },
  { value: FieldType.TypeNumber, labelKey: 'kinds.fieldTypeNumber' },
  { value: FieldType.TypeBoolean, labelKey: 'kinds.fieldTypeBoolean' },
  { value: FieldType.TypeOptions, labelKey: 'kinds.fieldTypeOptions' },
  { value: FieldType.TypeCardRef, labelKey: 'kinds.fieldTypeCardRef' },
]

function emptyField(): Field {
  return { Key: '', Label: '', Type: FieldType.TypeText } as Field
}

// The Kind editor pane (goal 0079): create or edit one card Kind --
// label, icon, description, and its typed fields under the ADR-0040
// evolution grammar the server enforces (a saved field's key and type
// never change; removing a saved field tombstones it, confirmed
// first). Mirrors ConfigureDecisions' output-field mechanics so the
// two evolution UIs can't drift apart in behavior.
export function AtlasKindEditor({ kind, kinds, onSaved, onCancel }: {
  kind: Kind | null
  // Every kind, for a cardref field's target-kind picker (goal 0152
  // slice 2: exactly one target kind, the converged relation shape).
  kinds: Kind[]
  onSaved: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation('atlas')
  const [label, setLabel] = useState(kind?.Label ?? '')
  const [icon, setIcon] = useState(kind?.Icon ?? '')
  const [description, setDescription] = useState(kind?.Description ?? '')
  const [fields, setFields] = useState<Field[]>(kind?.Fields ?? [])
  const [tombstones, setTombstones] = useState<FieldTombstone[]>([])
  const [savedKeys] = useState<Set<string>>(new Set((kind?.Fields ?? []).map((f) => f.Key)))
  const [pendingRemove, setPendingRemove] = useState<number | null>(null)
  const [error, setError] = useState('')

  const setField = (i: number, patch: Partial<Field>) => {
    setFields((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)))
  }

  const requestRemove = (i: number) => {
    if (savedKeys.has(fields[i].Key)) setPendingRemove(i)
    else setFields((prev) => prev.filter((_, idx) => idx !== i))
  }

  const confirmRemove = () => {
    if (pendingRemove === null) return
    const f = fields[pendingRemove]
    setTombstones((prev) => [...prev, { Key: f.Key, Type: f.Type } as FieldTombstone])
    setFields((prev) => prev.filter((_, idx) => idx !== pendingRemove))
    setPendingRemove(null)
  }

  const save = () => {
    setError('')
    const op = kind
      ? AtlasService.UpdateKind(kind.ID, label, description, icon, fields, tombstones)
      : AtlasService.CreateKind(label, description, icon, fields)
    op.then(() => onSaved()).catch((err) => setError(String(err)))
  }

  return (
    <Stack gap="normal" data-testid="atlas-kind-editor">
      <Stack direction="horizontal" gap="condensed">
        <FormControl>
          <FormControl.Label>{t('kinds.iconLabel')}</FormControl.Label>
          <TextInput size="small" value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="🧭" style={{ width: 64 }} data-testid="atlas-kind-icon" />
        </FormControl>
        <FormControl required>
          <FormControl.Label>{t('kinds.labelLabel')}</FormControl.Label>
          <TextInput size="small" value={label} onChange={(e) => setLabel(e.target.value)} data-testid="atlas-kind-label" />
        </FormControl>
      </Stack>
      <FormControl>
        <FormControl.Label>{t('kinds.descriptionLabel')}</FormControl.Label>
        <TextInput size="small" value={description} onChange={(e) => setDescription(e.target.value)} data-testid="atlas-kind-description" />
      </FormControl>

      <Text weight="semibold" size="small">{t('kinds.fieldsHeading')}</Text>
      {fields.length === 0 && (
        <Text size="small" className={runbookStyles.muted}>{t('kinds.fieldsEmpty')}</Text>
      )}
      {fields.map((f, i) => {
        const saved = savedKeys.has(f.Key) && f.Key !== ''
        return (
          <Stack key={i} direction="horizontal" gap="condensed" align="end" data-testid="atlas-kind-field-row">
            <FormControl>
              <FormControl.Label>{t('kinds.fieldKey')}</FormControl.Label>
              <TextInput size="small" value={f.Key} disabled={saved} onChange={(e) => setField(i, { Key: e.target.value })} data-testid="atlas-kind-field-key" />
            </FormControl>
            <FormControl>
              <FormControl.Label>{t('kinds.fieldLabel')}</FormControl.Label>
              <TextInput size="small" value={f.Label} onChange={(e) => setField(i, { Label: e.target.value })} data-testid="atlas-kind-field-label" />
            </FormControl>
            <FormControl>
              <FormControl.Label>{t('kinds.fieldType')}</FormControl.Label>
              <Select size="small" style={{ minWidth: 96 }} value={f.Type} disabled={saved} onChange={(e) => setField(i, { Type: e.target.value as FieldType })} data-testid="atlas-kind-field-type">
                {FIELD_TYPES.map((ft) => (
                  <Select.Option key={ft.value} value={ft.value}>{t(ft.labelKey)}</Select.Option>
                ))}
              </Select>
            </FormControl>
            {f.Type === FieldType.TypeCardRef && (
              <FormControl>
                <FormControl.Label>{t('kinds.refTargetKind')}</FormControl.Label>
                <Select size="small" style={{ minWidth: 110 }} value={f.RefKind ?? ''} onChange={(e) => setField(i, { RefKind: e.target.value })} data-testid="atlas-kind-field-refkind">
                  <Select.Option value="">{t('kinds.refTargetAny')}</Select.Option>
                  {kinds.map((k) => (
                    <Select.Option key={k.ID} value={k.ID}>{k.Label}</Select.Option>
                  ))}
                </Select>
              </FormControl>
            )}
            {f.Type === FieldType.TypeOptions && (
              <FormControl>
                <FormControl.Label>{t('kinds.fieldOptions')}</FormControl.Label>
                <TextInput
                  size="small"
                  value={(f.Options ?? []).join(', ')}
                  onChange={(e) => setField(i, { Options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                  data-testid="atlas-kind-field-options"
                />
              </FormControl>
            )}
            <FormControl>
              <FormControl.Label>{t('kinds.showOnCard')}</FormControl.Label>
              <Checkbox checked={f.ShowOnCard ?? false} onChange={(e) => setField(i, { ShowOnCard: e.target.checked })} data-testid="atlas-kind-field-showoncard" />
            </FormControl>
            <IconButton icon={TrashIcon} size="small" variant="invisible" aria-label={t('kinds.removeFieldAriaLabel', { key: f.Key })} onClick={() => requestRemove(i)} data-testid="atlas-kind-field-remove" />
          </Stack>
        )
      })}
      <div>
        <Button size="small" variant="invisible" onClick={() => setFields((prev) => [...prev, emptyField()])} data-testid="atlas-kind-add-field">
          {t('kinds.addField')}
        </Button>
      </div>

      {error && <Text size="small" className={runbookStyles.error} data-testid="atlas-kind-error">{error}</Text>}
      <Stack direction="horizontal" gap="condensed">
        <Button size="small" variant="primary" disabled={!label.trim()} onClick={save} data-testid="atlas-kind-save">
          {t('kinds.save')}
        </Button>
        <Button size="small" onClick={onCancel} data-testid="atlas-kind-cancel">{t('kinds.cancel')}</Button>
      </Stack>

      {pendingRemove !== null && (
        <ConfirmDialog
          title={t('kinds.removeFieldTitle', { key: fields[pendingRemove]?.Key ?? '' })}
          body={t('kinds.removeFieldBody')}
          confirmLabel={t('kinds.removeFieldConfirm')}
          onConfirm={confirmRemove}
          onCancel={() => setPendingRemove(null)}
        />
      )}
    </Stack>
  )
}

// The LinkKind editor pane: label + description only -- link kinds
// carry no typed fields (ADR-0038).
export function AtlasLinkKindEditor({ linkKind, onSaved, onCancel }: {
  linkKind: LinkKind | null
  onSaved: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation('atlas')
  const [label, setLabel] = useState(linkKind?.Label ?? '')
  const [description, setDescription] = useState(linkKind?.Description ?? '')
  const [error, setError] = useState('')

  const save = () => {
    setError('')
    const op = linkKind
      ? AtlasService.UpdateLinkKind(linkKind.ID, label, description)
      : AtlasService.CreateLinkKind(label, description)
    op.then(() => onSaved()).catch((err) => setError(String(err)))
  }

  return (
    <Stack gap="normal" data-testid="atlas-linkkind-editor">
      <FormControl required>
        <FormControl.Label>{t('kinds.labelLabel')}</FormControl.Label>
        <TextInput size="small" value={label} onChange={(e) => setLabel(e.target.value)} data-testid="atlas-linkkind-label" />
      </FormControl>
      <FormControl>
        <FormControl.Label>{t('kinds.descriptionLabel')}</FormControl.Label>
        <TextInput size="small" value={description} onChange={(e) => setDescription(e.target.value)} data-testid="atlas-linkkind-description" />
      </FormControl>
      {error && <Text size="small" className={runbookStyles.error} data-testid="atlas-linkkind-error">{error}</Text>}
      <Stack direction="horizontal" gap="condensed">
        <Button size="small" variant="primary" disabled={!label.trim()} onClick={save} data-testid="atlas-linkkind-save">
          {t('kinds.save')}
        </Button>
        <Button size="small" onClick={onCancel} data-testid="atlas-linkkind-cancel">{t('kinds.cancel')}</Button>
      </Stack>
    </Stack>
  )
}
