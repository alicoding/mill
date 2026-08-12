import { useEffect, useState } from 'react'
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
  const [lists, setLists] = useState<List[] | null>(null)

  useEffect(() => {
    ConfigureService.Lists().then((l) => setLists(l ?? [])).catch(() => setLists([]))
  }, [])

  const selectedList = lists?.find((l) => l.ID === listId)
  const columns = selectedList?.Columns ?? []

  const params = parseParams(matchParamsRaw)
  const writeParams = (next: MatchParam[]) => onChangeMatchParams(JSON.stringify(next))
  const updateParam = (i: number, patch: Partial<MatchParam>) =>
    writeParams(params.map((p, idx) => (idx === i ? { ...p, ...patch } : p)))
  const removeParam = (i: number) => writeParams(params.filter((_, idx) => idx !== i))
  const addParam = () =>
    writeParams([...params, { column: columns[0]?.Key ?? '', value: '', matchType: 'exact' }])

  return (
    <Stack direction="vertical" gap="condensed" data-testid="list-search-params-editor">
      <Text size="small" weight="semibold">Match parameters</Text>
      {!listId && (
        <Text as="p" size="small" className={styles.muted}>Pick a List above first.</Text>
      )}
      {listId && columns.length === 0 && (
        <Text as="p" size="small" className={styles.muted}>
          That List has no declared columns yet -- add some in Configure &gt; Lists.
        </Text>
      )}
      {params.map((p, i) => (
        <Stack key={i} direction="vertical" gap="condensed" className={styles.card}>
          <Stack direction="horizontal" gap="condensed" align="center">
            <FormControl>
              <FormControl.Label visuallyHidden>Column</FormControl.Label>
              <Select
                aria-label="Column"
                data-testid="list-search-param-column"
                value={p.column}
                onChange={(e) => updateParam(i, { column: e.target.value })}
              >
                <Select.Option value="">(pick a column)</Select.Option>
                {columns.map((c) => (
                  <Select.Option key={c.Key} value={c.Key}>{c.Label || c.Key}</Select.Option>
                ))}
              </Select>
            </FormControl>
            <FormControl>
              <FormControl.Label visuallyHidden>Match type</FormControl.Label>
              <Select
                aria-label="Match type"
                data-testid="list-search-param-matchtype"
                value={p.matchType}
                onChange={(e) => updateParam(i, { matchType: e.target.value as 'exact' | 'fuzzy' })}
              >
                <Select.Option value="exact">Exact</Select.Option>
                <Select.Option value="fuzzy">Fuzzy</Select.Option>
              </Select>
            </FormControl>
            <IconButton
              icon={TrashIcon}
              aria-label="Remove match parameter"
              size="small"
              variant="invisible"
              onClick={() => removeParam(i)}
            />
          </Stack>
          <LiteralOrAttributeField
            name="Value"
            value={p.value}
            attrs={attrs}
            onChange={(v) => updateParam(i, { value: v })}
          />
          {p.matchType === 'fuzzy' && (
            <FormControl>
              <FormControl.Label>Threshold</FormControl.Label>
              <FormControl.Caption>0..1 similarity (Damerau-Levenshtein); defaults to 0.7 if left blank.</FormControl.Caption>
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
      ))}
      <Button size="small" variant="invisible" leadingVisual={PlusIcon} onClick={addParam} data-testid="add-list-search-param">
        Add match parameter
      </Button>
    </Stack>
  )
}
