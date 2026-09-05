import { primitiveLabel } from './jsonTreeModel'
import type { TableData } from './outputShape'

// What the Table view puts in a cell, and what Copy puts on the
// clipboard from one (goal 0326). Pure, and its own module rather than
// shared/OutputTableView.tsx's: importing that component pulls the
// kit's stylesheets, which a unit test has no way to load.

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
// straight into cells. A tab or newline inside a value is flattened to
// a space, since either one would otherwise break the grid it is
// pasted into.
export function tableTsv(data: TableData): string {
  const header = data.columns.join('\t')
  const body = data.rows.map((row) => data.columns.map((c) => cellText(row[c]).replace(/\t/g, ' ').replace(/\n/g, ' ')).join('\t'))
  return [header, ...body].join('\n')
}
