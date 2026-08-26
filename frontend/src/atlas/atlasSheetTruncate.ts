// The sheet preview's own fixed cap (goal 0232 S2's design contract):
// a spreadsheet's first sheet renders at most this many rows/columns,
// with a truncation note below the grid when either cap actually cut
// something. Pure and Vitest-tested directly so the cap logic never
// needs a real parser or a rendered component to verify.
export const SHEET_MAX_ROWS = 50
export const SHEET_MAX_COLS = 12

export interface SheetTruncateResult {
  rows: unknown[][]
  totalRows: number
  totalCols: number
  truncatedRows: boolean
  truncatedCols: boolean
}

// truncateSheetRows caps a parsed sheet (papaparse's or read-excel-file's
// own array-of-arrays shape, header row included as rows[0]) at
// maxRows x maxCols. totalCols is the widest row in the FULL input --
// a ragged sheet (rows of differing length, which both parsers allow)
// is measured honestly rather than assumed rectangular.
export function truncateSheetRows(rows: unknown[][], maxRows: number = SHEET_MAX_ROWS, maxCols: number = SHEET_MAX_COLS): SheetTruncateResult {
  const totalRows = rows.length
  const totalCols = rows.reduce((max, row) => Math.max(max, row.length), 0)
  return {
    rows: rows.slice(0, maxRows).map((row) => row.slice(0, maxCols)),
    totalRows,
    totalCols,
    truncatedRows: totalRows > maxRows,
    truncatedCols: totalCols > maxCols,
  }
}

// A truncation note names which cap(s) actually cut something, always
// as one sentence (ux-writing.md) -- the caller looks up `key` in the
// 'sheet' locale namespace and interpolates `values`. null means
// nothing was truncated, so the caller renders no note at all.
export type SheetTruncationNote =
  | { key: 'sheet.truncatedRowsOnly'; values: { shownRows: number; totalRows: number } }
  | { key: 'sheet.truncatedColsOnly'; values: { shownCols: number; totalCols: number } }
  | { key: 'sheet.truncatedBoth'; values: { shownRows: number; totalRows: number; shownCols: number; totalCols: number } }
  | null

export function sheetTruncationNote(result: SheetTruncateResult, maxRows: number = SHEET_MAX_ROWS, maxCols: number = SHEET_MAX_COLS): SheetTruncationNote {
  if (result.truncatedRows && result.truncatedCols) {
    return { key: 'sheet.truncatedBoth', values: { shownRows: maxRows, totalRows: result.totalRows, shownCols: maxCols, totalCols: result.totalCols } }
  }
  if (result.truncatedRows) {
    return { key: 'sheet.truncatedRowsOnly', values: { shownRows: maxRows, totalRows: result.totalRows } }
  }
  if (result.truncatedCols) {
    return { key: 'sheet.truncatedColsOnly', values: { shownCols: maxCols, totalCols: result.totalCols } }
  }
  return null
}
