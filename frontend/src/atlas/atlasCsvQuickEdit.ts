import Papa from 'papaparse'

// The sheet quick-edit's csv round-trip (goal 0239 S2): parse once
// with FULL fidelity -- every source line kept, including empty ones
// -- and serialize the whole matrix back after a single cell change.
// The preview keeps hiding empty lines (the pre-quick-edit render
// behavior), so display rows carry a map back to their source rows
// rather than the parse dropping anything. Cell CONTENT fidelity is
// the contract (delimiter, newline style, interior empty lines, the
// trailing-newline state all survive); byte-layout minimalism is
// accepted -- papaparse re-quotes only where needed, the same way
// every spreadsheet app rewrites on save.

export interface CsvEditModel {
  // Every source line, in order, empty lines included.
  fullRows: string[][]
  // The rows the preview renders (empty source lines hidden).
  displayRows: string[][]
  // displayRows index -> fullRows index.
  sourceIndex: number[]
  delimiter: string
  newline: '\n' | '\r\n'
}

// Papa's own empty-line shape: a single empty field.
function isEmptyLine(row: string[]): boolean {
  return row.length === 1 && row[0] === ''
}

export function parseCsvForEdit(text: string): CsvEditModel {
  // Delimiter detection runs on a skip-empty preview parse: with
  // empty lines kept, Papa's guesser can prefer a wrong delimiter
  // whose field counts happen to stay consistent across the empty
  // rows (a trailing newline alone is enough to trip it).
  const guessed = Papa.parse<string[]>(text, { skipEmptyLines: true, preview: 10 }).meta.delimiter || ','
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: false, delimiter: guessed })
  const fullRows = parsed.data
  const displayRows: string[][] = []
  const sourceIndex: number[] = []
  fullRows.forEach((row, i) => {
    if (!isEmptyLine(row)) {
      displayRows.push(row)
      sourceIndex.push(i)
    }
  })
  return {
    fullRows,
    displayRows,
    sourceIndex,
    delimiter: parsed.meta.delimiter || ',',
    newline: text.includes('\r\n') ? '\r\n' : '\n',
  }
}

// serializeCellEdit -- the full matrix with ONE cell changed, as the
// text to write back. A short source row pads with empty fields only
// as far as the edited column (the spreadsheet convention: typing
// past a row's end creates the cells between).
export function serializeCellEdit(model: CsvEditModel, displayRow: number, col: number, value: string): string {
  const target = model.sourceIndex[displayRow]
  if (target === undefined) throw new Error(`no source row for display row ${displayRow}`)
  const rows = model.fullRows.map((row) => [...row])
  const row = rows[target]
  while (row.length <= col) row.push('')
  row[col] = value
  return Papa.unparse(rows, { delimiter: model.delimiter, newline: model.newline })
}
