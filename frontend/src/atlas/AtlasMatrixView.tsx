import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, FormControl, Link as PrimerLink, Select, Stack, Text } from '@primer/react'
import { DataTable, type Column } from '@primer/react/experimental'
import type { Card, Kind, Link, LinkKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { buildTraceabilityMatrix, type MatrixTarget } from './atlasProjections'
import runbookStyles from '../shared/ListCard.module.css'

interface MatrixRowData {
  id: string
  card: Card
  cells: MatrixTarget[][]
}

// The free traceability matrix (docs/goals/0064, ADR-0038): rows are
// the viewed space's own cards of one chosen Kind, columns are link
// kinds (or one, when narrowed), cells are the OUTGOING target
// titles for that row/column pair -- an absent cell reads "None",
// never an ambiguous blank (ux-writing.md). View-only v1: a cell's
// targets are click-to-open, nothing here edits a link.
export function AtlasMatrixView({ open, onClose, cards, kinds, links, linkKinds, onOpenCard }: {
  open: boolean
  onClose: () => void
  cards: Card[]
  kinds: Kind[]
  links: Link[]
  linkKinds: LinkKind[]
  onOpenCard: (id: string) => void
}) {
  const { t } = useTranslation('atlas')
  const [rowKindID, setRowKindID] = useState(kinds[0]?.ID ?? '')
  const [columnFilter, setColumnFilter] = useState('')

  const rowCards = cards.filter((c) => c.KindID === rowKindID)
  const titleByID = useMemo(() => new Map(cards.map((c) => [c.ID, c.Title])), [cards])
  const matrix = buildTraceabilityMatrix(rowCards, links, linkKinds, titleByID, columnFilter)
  const rows: MatrixRowData[] = matrix.rows.map((r) => ({ id: r.card.ID, card: r.card, cells: r.cells }))

  const columns: Column<MatrixRowData>[] = [
    { id: 'card', header: t('matrix.cardColumn'), rowHeader: true, renderCell: (row) => row.card.Title },
    ...matrix.columns.map((lk, i): Column<MatrixRowData> => ({
      id: lk.ID,
      header: lk.Label,
      renderCell: (row) => {
        const targets = row.cells[i]
        if (targets.length === 0) {
          return <Text size="small" className={runbookStyles.muted} data-testid="atlas-matrix-absent-cell">{t('matrix.absentCell')}</Text>
        }
        return (
          <Stack direction="horizontal" gap="condensed" wrap="wrap">
            {targets.map((target) => (
              <PrimerLink
                key={target.cardID}
                as="button"
                type="button"
                data-testid="atlas-matrix-target"
                onClick={() => onOpenCard(target.cardID)}
              >
                {target.title}
              </PrimerLink>
            ))}
          </Stack>
        )
      },
    })),
  ]

  if (!open) return null

  return (
    <Dialog title={t('matrix.title')} onClose={onClose} width="min(1000px, calc(100vw - 64px))" data-component="atlas-matrix-dialog">
      <Stack direction="horizontal" gap="condensed" wrap="wrap">
        <FormControl>
          <FormControl.Label>{t('matrix.rowKindLabel')}</FormControl.Label>
          <Select value={rowKindID} data-testid="atlas-matrix-row-kind" onChange={(e) => setRowKindID(e.target.value)}>
            {kinds.map((k) => (
              <Select.Option key={k.ID} value={k.ID}>{k.Icon ? `${k.Icon} ${k.Label}` : k.Label}</Select.Option>
            ))}
          </Select>
        </FormControl>
        <FormControl>
          <FormControl.Label>{t('matrix.columnFilterLabel')}</FormControl.Label>
          <Select value={columnFilter} data-testid="atlas-matrix-column-filter" onChange={(e) => setColumnFilter(e.target.value)}>
            <Select.Option value="">{t('matrix.anyLinkKind')}</Select.Option>
            {linkKinds.map((lk) => (
              <Select.Option key={lk.ID} value={lk.ID}>{lk.Label}</Select.Option>
            ))}
          </Select>
        </FormControl>
      </Stack>

      {rowCards.length === 0 ? (
        <Text as="p" size="small" className={runbookStyles.muted}>{t('matrix.empty')}</Text>
      ) : (
        <DataTable data={rows} columns={columns} cellPadding="condensed" getRowId={(row) => row.id} />
      )}
    </Dialog>
  )
}
