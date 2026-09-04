import { useMemo } from 'react'
import { DataTable, type Column } from '@primer/react/experimental'
import { OutputHighlight } from './OutputHighlight'
import { primitiveLabel } from './jsonTreeModel'
import type { TableData } from './outputShape'
import styles from './OutputViewer.module.css'

// The Table view (goal 0326): an array of objects as rows, never a
// wall of text. Read-only by construction -- Primer's DataTable is the
// kit's own presentation table (views/ActivityView.tsx is its other
// consumer); the editing grid is a List's authoring plane and has no
// place over output nobody can edit.

interface Row {
  id: string
  values: Record<string, unknown>
}

// A nested object inside a cell stays JSON: the Tree view is where a
// reader opens it, and a table cell that silently flattened it would
// hide what is there.
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return typeof value === 'string' ? value : primitiveLabel(value)
}

// Tab-separated, header row first: what every spreadsheet pastes
// straight into cells.
export function tableTsv(data: TableData): string {
  const header = data.columns.join('\t')
  const body = data.rows.map((row) => data.columns.map((c) => cellText(row[c]).replace(/\t/g, ' ').replace(/\n/g, ' ')).join('\t'))
  return [header, ...body].join('\n')
}

export function OutputTableView({ data, query = '', ariaLabel, testId }: { data: TableData; query?: string; ariaLabel: string; testId?: string }) {
  const rows: Row[] = useMemo(() => data.rows.map((values, index) => ({ id: String(index), values })), [data.rows])
  const columns: Column<Row>[] = useMemo(
    () =>
      data.columns.map((key) => ({
        id: key,
        header: key,
        renderCell: (row: Row) => <span className={styles.cell}><OutputHighlight text={cellText(row.values[key])} query={query} /></span>,
      })),
    [data.columns, query],
  )
  return (
    <div className={styles.table} data-scroll-region="output-table" data-testid={testId}>
      <DataTable aria-label={ariaLabel} data={rows} columns={columns} cellPadding="condensed" getRowId={(row) => row.id} />
    </div>
  )
}
