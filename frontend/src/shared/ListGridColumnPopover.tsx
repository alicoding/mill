import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnchoredOverlay, Button, Checkbox, FormControl, Select, Text, Textarea } from '@primer/react'
import { type Field, Type as FieldType } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import { ConfirmDialog } from './ConfirmDialog'
import styles from './ListGrid.module.css'

// The column's schema home (goal 0136): everything a column IS beyond
// its label -- type, option values, deprecation, removal -- anchored
// to the header it describes. Rename stays on the header label itself;
// this popover re-homes the old Configure column form's remaining
// fields so the grid is the whole editor. Key is shown, not editable
// (immutable once saved -- the schema-evolution guard).
export function ListGridColumnPopover({ column, onCommit, onRemove, open, onClose, anchorRef }: {
  column: Field
  // onCommit receives the changed column; the grid owns the
  // read-modify-write against the List record.
  onCommit: (next: Field) => void
  // onRemove tombstones the column (the grid supplies the confirm's
  // consequence -- ADR-0040's removal rules run server-side).
  onRemove: () => void
  // Controlled (ADR-0049): the grid's column menu owns open/close and
  // supplies the anchor at the header's own rectangle.
  open: boolean
  onClose: () => void
  anchorRef: React.RefObject<HTMLElement | null>
}) {
  const { t } = useTranslation('common')
  const setOpen = (next: boolean) => {
    if (!next) onClose()
  }
  const [confirming, setConfirming] = useState(false)
  const [draft, setDraft] = useState<Field>(column)

  const openWithFresh = () => {
    setDraft(column)
    setOpen(true)
  }
  const commit = (next: Field) => {
    setDraft(next)
    onCommit(next)
  }

  return (
    <>
      <AnchoredOverlay open={open && !confirming} onOpen={openWithFresh} onClose={() => setOpen(false)} anchorRef={anchorRef as React.RefObject<HTMLElement>} renderAnchor={null}>
        <div className={styles.popover}>
          <Text size="small" className={styles.keyLine}>
            {t('listGrid.keyLabel')}: <code>{column.Key}</code>
          </Text>
          <FormControl>
            <FormControl.Label>{t('listGrid.typeLabel')}</FormControl.Label>
            <Select
              value={draft.Type}
              data-testid="list-grid-column-type"
              onChange={(e) => commit({ ...draft, Type: e.target.value as Field['Type'] })}
            >
              <Select.Option value={FieldType.TypeText}>{t('listGrid.typeText')}</Select.Option>
              <Select.Option value={FieldType.TypeNumber}>{t('listGrid.typeNumber')}</Select.Option>
              <Select.Option value={FieldType.TypeBoolean}>{t('listGrid.typeBoolean')}</Select.Option>
              <Select.Option value={FieldType.TypeOptions}>{t('listGrid.typeOptions')}</Select.Option>
            </Select>
          </FormControl>
          {draft.Type === FieldType.TypeOptions && (
            <FormControl>
              <FormControl.Label>{t('listGrid.optionsLabel')}</FormControl.Label>
              <Textarea
                rows={4}
                value={(draft.Options ?? []).join('\n')}
                data-testid="list-grid-column-options"
                onChange={(e) => setDraft({ ...draft, Options: e.target.value.split('\n') })}
                onBlur={() => commit({ ...draft, Options: (draft.Options ?? []).map((o) => o.trim()).filter((o) => o !== '') })}
              />
              <FormControl.Caption>{t('listGrid.optionsCaption')}</FormControl.Caption>
            </FormControl>
          )}
          <FormControl>
            <Checkbox
              checked={draft.deprecated ?? false}
              data-testid="list-grid-column-deprecated"
              onChange={(e) => commit({ ...draft, deprecated: e.target.checked })}
            />
            <FormControl.Label>{t('listGrid.deprecatedLabel')}</FormControl.Label>
          </FormControl>
          <Button
            size="small"
            variant="danger"
            data-testid="list-grid-column-remove"
            onClick={() => setConfirming(true)}
          >
            {t('listGrid.removeColumn')}
          </Button>
        </div>
      </AnchoredOverlay>
      {confirming && (
        <ConfirmDialog
          title={t('listGrid.removeColumnConfirmTitle')}
          body={t('listGrid.removeColumnConfirmBody', { column: column.Label || column.Key })}
          confirmLabel={t('listGrid.removeColumn')}
          cancelLabel={t('cancel')}
          onCancel={() => { setConfirming(false); onClose() }}
          onConfirm={() => { setConfirming(false); onRemove() }}
        />
      )}
    </>
  )
}
