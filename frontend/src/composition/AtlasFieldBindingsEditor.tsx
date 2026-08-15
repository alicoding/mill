import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Stack, Text } from '@primer/react'
import { AtlasService } from '../shared/bindings'
import type { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { AttributeDef } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { LiteralOrAttributeField } from '../shared/LiteralOrAttributeField'
import styles from '../shared/ListCard.module.css'

// apply-atlas-card-create/update's own field-value editor (goal 0066):
// once a Kind is picked, fetches its real declared Fields
// (AtlasService.Kinds(), the same data Configure > Atlas itself edits)
// and renders one binding row per field -- ChildWorkflowBindingsEditor's
// identical shape (a target's own declared schema drives the rows),
// applied here to a Kind's typedfield.Field list instead of a child
// workflow's Attributes.
function parseBindings(raw: string): Record<string, string> {
  if (!raw) return {}
  try {
    return JSON.parse(raw) as Record<string, string>
  } catch {
    return {}
  }
}

export function AtlasFieldBindingsEditor({
  kindId, attrs, fieldBindingsRaw, onChangeFieldBindings,
}: {
  kindId: string
  attrs: AttributeDef[]
  fieldBindingsRaw: string
  onChangeFieldBindings: (raw: string) => void
}) {
  const { t } = useTranslation('composition')
  const [kinds, setKinds] = useState<Kind[] | null>(null)

  useEffect(() => {
    AtlasService.Kinds().then((k) => setKinds(k ?? [])).catch(() => setKinds([]))
  }, [])

  const selectedKind = kinds?.find((k) => k.ID === kindId)
  const fields = selectedKind?.Fields ?? []

  const bindings = parseBindings(fieldBindingsRaw)
  const setBinding = (key: string, value: string) => {
    onChangeFieldBindings(JSON.stringify({ ...bindings, [key]: value }))
  }

  return (
    <Stack direction="vertical" gap="condensed" data-testid="atlas-field-bindings-editor">
      <Text size="small" weight="semibold">{t('atlasFieldBindingsEditor.fieldValues')}</Text>
      {!kindId && (
        <Text as="p" size="small" className={styles.muted}>{t('atlasFieldBindingsEditor.pickKindFirst')}</Text>
      )}
      {kindId && fields.length === 0 && kinds !== null && (
        <Text as="p" size="small" className={styles.muted}>{t('atlasFieldBindingsEditor.noFieldsYet')}</Text>
      )}
      {fields.map((f) => (
        <LiteralOrAttributeField
          key={f.Key}
          name={f.Label || f.Key}
          value={bindings[f.Key] ?? ''}
          attrs={attrs}
          onChange={(value) => setBinding(f.Key, value)}
        />
      ))}
    </Stack>
  )
}
