import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, FormControl, IconButton, Select, Stack, Text, TextInput } from '@primer/react'
import { PlusIcon, TrashIcon } from '@primer/octicons-react'
import { AtlasService } from '../shared/bindings'
import type { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { AttributeDef } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { LiteralOrAttributeField } from '../shared/LiteralOrAttributeField'
import styles from '../shared/ListCard.module.css'

// process-atlas-card-find's own match-parameter editor -- the same
// shape ListSearchParamsEditor.tsx already establishes for list-search,
// applied to a Kind's own declared Fields (plus the built-in "title"
// column every card carries) instead of a List's Columns.
interface MatchParam {
  column: string
  value: string
  matchType: 'exact' | 'fuzzy'
  threshold?: number
}

const TITLE_COLUMN = 'title'

function parseParams(raw: string): MatchParam[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as MatchParam[]) : []
  } catch {
    return []
  }
}

export function AtlasCardMatchParamsEditor({
  kindId, matchParamsRaw, attrs, onChangeMatchParams,
}: {
  kindId: string
  matchParamsRaw: string
  attrs: AttributeDef[]
  onChangeMatchParams: (raw: string) => void
}) {
  const { t } = useTranslation('composition')
  const [kinds, setKinds] = useState<Kind[] | null>(null)

  useEffect(() => {
    AtlasService.Kinds().then((k) => setKinds(k ?? [])).catch(() => setKinds([]))
  }, [])

  const selectedKind = kinds?.find((k) => k.ID === kindId)
  const columns = [
    { Key: TITLE_COLUMN, Label: t('atlasCardMatchParamsEditor.title') },
    ...(selectedKind?.Fields ?? []).map((f) => ({ Key: f.Key, Label: f.Label || f.Key })),
  ]

  const params = parseParams(matchParamsRaw)
  const writeParams = (next: MatchParam[]) => onChangeMatchParams(JSON.stringify(next))
  const updateParam = (i: number, patch: Partial<MatchParam>) =>
    writeParams(params.map((p, idx) => (idx === i ? { ...p, ...patch } : p)))
  const removeParam = (i: number) => writeParams(params.filter((_, idx) => idx !== i))
  const addParam = () => writeParams([...params, { column: TITLE_COLUMN, value: '', matchType: 'exact' }])

  return (
    <Stack direction="vertical" gap="condensed" data-testid="atlas-card-match-params-editor">
      <Text size="small" weight="semibold">{t('atlasCardMatchParamsEditor.matchParameters')}</Text>
      {!kindId && (
        <Text as="p" size="small" className={styles.muted}>{t('atlasCardMatchParamsEditor.pickKindFirst')}</Text>
      )}
      {params.map((p, i) => (
        <Stack key={i} direction="vertical" gap="condensed" className={styles.card}>
          <Stack direction="horizontal" gap="condensed" align="center">
            <FormControl>
              <FormControl.Label visuallyHidden>{t('atlasCardMatchParamsEditor.column')}</FormControl.Label>
              <Select
                aria-label={t('atlasCardMatchParamsEditor.column')}
                data-testid="atlas-card-match-param-column"
                value={p.column}
                onChange={(e) => updateParam(i, { column: e.target.value })}
              >
                {columns.map((c) => (
                  <Select.Option key={c.Key} value={c.Key}>{c.Label}</Select.Option>
                ))}
              </Select>
            </FormControl>
            <FormControl>
              <FormControl.Label visuallyHidden>{t('atlasCardMatchParamsEditor.matchType')}</FormControl.Label>
              <Select
                aria-label={t('atlasCardMatchParamsEditor.matchType')}
                data-testid="atlas-card-match-param-matchtype"
                value={p.matchType}
                onChange={(e) => updateParam(i, { matchType: e.target.value as 'exact' | 'fuzzy' })}
              >
                <Select.Option value="exact">{t('atlasCardMatchParamsEditor.exact')}</Select.Option>
                <Select.Option value="fuzzy">{t('atlasCardMatchParamsEditor.fuzzy')}</Select.Option>
              </Select>
            </FormControl>
            <IconButton
              icon={TrashIcon}
              aria-label={t('atlasCardMatchParamsEditor.removeMatchParameterAriaLabel')}
              size="small"
              variant="invisible"
              onClick={() => removeParam(i)}
            />
          </Stack>
          <LiteralOrAttributeField
            name={t('atlasCardMatchParamsEditor.value')}
            value={p.value}
            attrs={attrs}
            onChange={(v) => updateParam(i, { value: v })}
          />
          {p.matchType === 'fuzzy' && (
            <FormControl>
              <FormControl.Label>{t('atlasCardMatchParamsEditor.threshold')}</FormControl.Label>
              <FormControl.Caption>{t('atlasCardMatchParamsEditor.thresholdCaption')}</FormControl.Caption>
              <TextInput
                type="number"
                data-testid="atlas-card-match-param-threshold"
                value={p.threshold ?? ''}
                onChange={(e) => {
                  const v = e.target.value
                  updateParam(i, { threshold: v === '' ? undefined : parseFloat(v) })
                }}
              />
            </FormControl>
          )}
        </Stack>
      ))}
      <Button size="small" variant="invisible" leadingVisual={PlusIcon} onClick={addParam} data-testid="add-atlas-card-match-param">
        {t('atlasCardMatchParamsEditor.addMatchParameter')}
      </Button>
    </Stack>
  )
}
