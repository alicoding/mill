import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, FormControl, IconButton, Select, Stack, Text, TextInput } from '@primer/react'
import { PlusIcon, TrashIcon } from '@primer/octicons-react'
import { ConfigureService } from '../shared/bindings'
import type { List } from '../../bindings/github.com/alicoding/mill/internal/domain/list/models'
import type { AttributeDef } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { LiteralOrAttributeField } from '../shared/LiteralOrAttributeField'
import styles from '../shared/ListCard.module.css'

// The list-search node's match-parameter editor (docs/goals/0011-
// lists-maturation.md item 4): once a List is picked, fetches its
// real Columns (ConfigureService.Lists(), the same data ConfigureLists
// itself edits) and renders one row per match parameter -- a column
// picker from the List's own declared columns, a literal-or-attribute
// value binding (the shared LiteralOrAttributeField every other
// binding editor in this folder already uses), an exact/fuzzy match
// type, and a threshold input shown only when fuzzy. Owns matchParams
// entirely -- NodeInspector.tsx skips it in its generic ConfigFields
// loop (same reasoning as MCPToolArgsEditor owning toolName/
// argumentsJSON) and renders this component instead.
interface MatchParam {
  column: string
  value: string
  matchType: 'exact' | 'fuzzy'
  threshold?: number
}

function parseParams(raw: string): MatchParam[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as MatchParam[]) : []
  } catch {
    return []
  }
}

export function ListSearchParamsEditor({
  listId, matchParamsRaw, attrs, onChangeMatchParams,
}: {
  listId: string
  matchParamsRaw: string
  attrs: AttributeDef[]
  onChangeMatchParams: (raw: string) => void
}) {
  const { t } = useTranslation('composition')
  const [lists, setLists] = useState<List[] | null>(null)

  useEffect(() => {
    ConfigureService.Lists().then((l) => setLists(l ?? [])).catch(() => setLists([]))
  }, [])

  const selectedList = lists?.find((l) => l.ID === listId)
  const columns = selectedList?.Columns ?? []
  // docs/adr/0040 decision 2: a Deprecated column offers itself as a
  // NEW match parameter's default only when it isn't deprecated;
  // pickableColumns (below, per-row) still includes one already bound
  // to an existing row, so an existing match parameter never loses its
  // own column out from under it.
  const newParamColumns = columns.filter((c) => !c.deprecated)

  const params = parseParams(matchParamsRaw)
  const writeParams = (next: MatchParam[]) => onChangeMatchParams(JSON.stringify(next))
  const updateParam = (i: number, patch: Partial<MatchParam>) =>
    writeParams(params.map((p, idx) => (idx === i ? { ...p, ...patch } : p)))
  const removeParam = (i: number) => writeParams(params.filter((_, idx) => idx !== i))
  const addParam = () =>
    writeParams([...params, { column: newParamColumns[0]?.Key ?? '', value: '', matchType: 'exact' }])

  return (
    <Stack direction="vertical" gap="condensed" data-testid="list-search-params-editor">
      <Text size="small" weight="semibold">{t('listSearchParamsEditor.matchParameters')}</Text>
      {!listId && (
        <Text as="p" size="small" className={styles.muted}>{t('listSearchParamsEditor.pickListFirst')}</Text>
      )}
      {listId && columns.length === 0 && (
        <Text as="p" size="small" className={styles.muted}>
          {t('listSearchParamsEditor.noColumnsYet')}
        </Text>
      )}
      {params.map((p, i) => {
        // A deprecated column that's already this row's own value must
        // still render as a selectable option (never dropping existing
        // data) even though it's excluded from newParamColumns above.
        const pickableColumns = newParamColumns.some((c) => c.Key === p.column) || !p.column
          ? newParamColumns
          : [...newParamColumns, ...columns.filter((c) => c.Key === p.column)]
        return (
        <Stack key={i} direction="vertical" gap="condensed" className={styles.card}>
          <Stack direction="horizontal" gap="condensed" align="center">
            <FormControl>
              <FormControl.Label visuallyHidden>{t('listSearchParamsEditor.column')}</FormControl.Label>
              <Select
                aria-label={t('listSearchParamsEditor.column')}
                data-testid="list-search-param-column"
                value={p.column}
                onChange={(e) => updateParam(i, { column: e.target.value })}
              >
                <Select.Option value="">{t('listSearchParamsEditor.pickColumn')}</Select.Option>
                {pickableColumns.map((c) => (
                  <Select.Option key={c.Key} value={c.Key}>{c.Label || c.Key}</Select.Option>
                ))}
              </Select>
            </FormControl>
            <FormControl>
              <FormControl.Label visuallyHidden>{t('listSearchParamsEditor.matchType')}</FormControl.Label>
              <Select
                aria-label={t('listSearchParamsEditor.matchType')}
                data-testid="list-search-param-matchtype"
                value={p.matchType}
                onChange={(e) => updateParam(i, { matchType: e.target.value as 'exact' | 'fuzzy' })}
              >
                <Select.Option value="exact">{t('listSearchParamsEditor.exact')}</Select.Option>
                <Select.Option value="fuzzy">{t('listSearchParamsEditor.fuzzy')}</Select.Option>
              </Select>
            </FormControl>
            <IconButton
              icon={TrashIcon}
              aria-label={t('listSearchParamsEditor.removeMatchParameterAriaLabel')}
              size="small"
              variant="invisible"
              onClick={() => removeParam(i)}
            />
          </Stack>
          <LiteralOrAttributeField
            name={t('listSearchParamsEditor.value')}
            value={p.value}
            attrs={attrs}
            onChange={(v) => updateParam(i, { value: v })}
          />
          {p.matchType === 'fuzzy' && (
            <FormControl>
              <FormControl.Label>{t('listSearchParamsEditor.threshold')}</FormControl.Label>
              <FormControl.Caption>{t('listSearchParamsEditor.thresholdCaption')}</FormControl.Caption>
              <TextInput
                type="number"
                data-testid="list-search-param-threshold"
                value={p.threshold ?? ''}
                onChange={(e) => {
                  const v = e.target.value
                  updateParam(i, { threshold: v === '' ? undefined : parseFloat(v) })
                }}
              />
            </FormControl>
          )}
        </Stack>
        )
      })}
      <Button size="small" variant="invisible" leadingVisual={PlusIcon} onClick={addParam} data-testid="add-list-search-param">
        {t('listSearchParamsEditor.addMatchParameter')}
      </Button>
    </Stack>
  )
}
