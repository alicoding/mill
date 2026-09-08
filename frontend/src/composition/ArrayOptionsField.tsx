import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, SelectPanel } from '@primer/react'
import type { SelectPanelItemInput as ItemInput } from '@primer/react'
import { TriangleDownIcon } from '@primer/octicons-react'
import { background } from '../shared/background'
import { fetchOptionsSourceItems, parseSelectedIds } from './arrayOptionsSource'
import type { SourceItem } from './arrayOptionsSource'
import type { Field as TypedField } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'

// Renders a TypeArray field whose Items declare an OptionsSource
// (docs/goals/0372's "targets" field is the first) as the kit's own
// multi-select panel (Primer SelectPanel, a `selected` ItemInput array)
// -- never a comma-separated text field, never a hand-rolled picker.
// The wire value stays a plain JSON array of ids, matching every other
// ConfigField's plain-string convention.
export function ArrayOptionsField({ field, value, onChange }: { field: TypedField; value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation('composition')
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<SourceItem[] | null>(null)
  const [filter, setFilter] = useState('')

  const source = field.Items?.OptionsSource ?? ''

  useEffect(() => {
    let cancelled = false
    void background(
      fetchOptionsSourceItems(source, field.Items?.Needs ?? undefined, t).then((result) => {
        if (!cancelled) setItems(result)
      }),
      'arrayOptionsField.fetchOptions',
    )
    return () => {
      cancelled = true
    }
    // A mounted field's source/Needs never change mid-life (they're
    // declared per node type, EntityRefField's own refKind makes the
    // same one-mount assumption for the identical reason).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectedIds = parseSelectedIds(value)
  const allItems: ItemInput[] = (items ?? []).map((it) => ({ id: it.id, text: it.label }))
  const filteredItems = filter
    ? allItems.filter((it) => (it.text ?? '').toLowerCase().includes(filter.toLowerCase()))
    : allItems
  const selected: ItemInput[] = allItems.filter((it) => selectedIds.includes(String(it.id)))

  return (
    <SelectPanel
      title={field.Label}
      placeholder={t('nodeInspector.deviceFilterPlaceholder')}
      open={open}
      onOpenChange={setOpen}
      items={filteredItems}
      selected={selected}
      onSelectedChange={(next) => onChange(JSON.stringify(next.map((it) => String(it.id))))}
      onFilterChange={setFilter}
      loading={items === null}
      message={
        items !== null && items.length === 0
          ? { title: t('nodeInspector.noDevicesPaired'), body: '', variant: 'empty' }
          : undefined
      }
      renderAnchor={(anchorProps) => (
        <Button {...anchorProps} trailingAction={TriangleDownIcon} data-testid="array-options-field-anchor">
          {selected.length === 0 ? t('nodeInspector.deviceTargetsEveryDevice') : t('nodeInspector.deviceTargetsSelectedCount', { count: selected.length })}
        </Button>
      )}
    />
  )
}
