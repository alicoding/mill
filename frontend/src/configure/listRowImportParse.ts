import Papa from 'papaparse'
import type { Field } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import { Type as ConfigFieldType } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import { ConfigureService, type ParsedXlsxFile } from '../shared/bindings'
import { blobToBase64 } from '../shared/base64Blob'

// docs/goals/0070's CSV/JSON row import: parsing lives here, pure and
// framework-free, so the mapping/validation logic is unit-testable
// without mounting ListRowImport.tsx's dialog. PapaParse is the
// existing CSV precedent (openapiSynth.ts's parseCSVToOperations,
// docs/SPEC.md §3.5's own deferral note) -- reused here rather than a
// second hand-rolled CSV path. JSON has no such library need: it's a
// plain array-of-objects parse.

// SKIP_TARGET is the mapping Select's own "don't import this column"
// option value -- distinct from "" so it can never collide with a
// genuinely empty/unset mapping.
export const SKIP_TARGET = '__skip__'

export interface ParsedFile {
  fileColumns: string[]
  // Every cell is stringified up front (Values is always
  // map[string]string on the wire, same discipline typedfield.Field's
  // own doc comment states) -- a JSON file with a real number/boolean
  // in a cell is coerced to its string form here, once, rather than at
  // every later read site.
  rows: Record<string, string>[]
}

// parseImportFile dispatches on the file's extension -- .csv via
// PapaParse (header: true, same options parseCSVToOperations already
// uses), anything else attempts JSON (an array of flat objects).
// Throws a plain Error with a copy-ready message on a genuinely
// unparseable file (the caller surfaces it the same way every other
// this-page action surfaces an error).
export function parseImportFile(fileName: string, text: string): ParsedFile {
  if (fileName.toLowerCase().endsWith('.csv')) {
    const result = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true })
    const fileColumns = result.meta.fields ?? []
    return { fileColumns, rows: result.data }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw Object.assign(new Error(`the file isn't valid JSON or CSV: ${String(err)}`), { cause: err })
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('the file must contain a JSON array of row objects')
  }
  const fileColumns: string[] = []
  const seen = new Set<string>()
  const rows: Record<string, string>[] = []
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error('every entry in the JSON array must be a plain object (one row)')
    }
    const row: Record<string, string> = {}
    for (const [key, value] of Object.entries(entry as Record<string, unknown>)) {
      if (!seen.has(key)) {
        seen.add(key)
        fileColumns.push(key)
      }
      row[key] = value === null || value === undefined ? '' : String(value)
    }
    rows.push(row)
  }
  return { fileColumns, rows }
}

// normalizeParsedXlsxFile converts the Go binding's own shape (whose
// slices/maps are typed nullable since Go's zero value for a slice is
// nil) into the same never-null ParsedFile CSV/JSON already produce --
// downstream code never has to know xlsx came through a different
// binding.
function normalizeParsedXlsxFile(raw: ParsedXlsxFile): ParsedFile {
  return {
    fileColumns: raw.FileColumns ?? [],
    // The binding's per-cell type is optional (Go's map[string]string
    // has no TS equivalent for "always present"), but ParseXlsxFile's
    // own Go implementation writes every header key into every row --
    // safe to assert back to the always-present shape parseImportFile's
    // CSV/JSON branches already return.
    rows: (raw.Rows ?? []).map((row) => (row ?? {})) as Record<string, string>[],
  }
}

// parseUploadedFile is parseImportFile's own dispatch, extended one
// branch further: .xlsx is binary, so it can never go through
// file.text() the way CSV/JSON do (parseImportFile's own signature is
// text-only for exactly that reason) -- its bytes go to the Go-side
// excelize parser (docs/goals/0133 slice 4) instead, then converge on
// the identical ParsedFile shape via normalizeParsedXlsxFile above. The
// mapping/inference pipeline downstream (autoMatchColumns, mapRowValues,
// inferListSchema) never learns xlsx exists.
export async function parseUploadedFile(file: File): Promise<ParsedFile> {
  if (file.name.toLowerCase().endsWith('.xlsx')) {
    const base64 = await blobToBase64(file)
    const raw = await ConfigureService.ParseXlsxFile(base64)
    return normalizeParsedXlsxFile(raw)
  }
  const text = await file.text()
  return parseImportFile(file.name, text)
}

// autoMatchColumns pre-fills the mapping Select for each file column
// whose name matches a List column's Key or Label, case-insensitively
// -- the "auto-matched by name where names align" acceptance. A file
// column with no alignment defaults to SKIP_TARGET, never a guess.
export function autoMatchColumns(fileColumns: string[], listColumns: Field[]): Record<string, string> {
  const byLower = new Map<string, string>()
  for (const c of listColumns) {
    byLower.set(c.Key.toLowerCase(), c.Key)
    byLower.set(c.Label.toLowerCase(), c.Key)
  }
  const mapping: Record<string, string> = {}
  for (const fc of fileColumns) {
    mapping[fc] = byLower.get(fc.toLowerCase()) ?? SKIP_TARGET
  }
  return mapping
}

// mapRowValues applies mapping to one raw file row, independent of
// validity -- the preview table's own read (shows what WOULD be
// written, including a row that buildMappedRows will go on to skip).
export function mapRowValues(row: Record<string, string>, mapping: Record<string, string>): Record<string, string> {
  const values: Record<string, string> = {}
  for (const [fileCol, targetKey] of Object.entries(mapping)) {
    if (targetKey === SKIP_TARGET) continue
    values[targetKey] = row[fileCol] ?? ''
  }
  return values
}

export interface SkippedRow {
  row: number // 1-based, matching a spreadsheet's own row numbering
  reason: string
}

export interface MappedImport {
  imported: Record<string, string>[]
  skipped: SkippedRow[]
}

// validateTypedValue mirrors typedfield.ValidateValue's own rules
// (internal/domain/typedfield/typedfield.go) closely enough for an
// honest client-side preview -- the authority is still the server
// (AddListRow's own persisted write), this only decides what the
// import dialog shows BEFORE anything is sent.
function validateTypedValue(column: Field, raw: string): string | null {
  if (raw === '') return null
  switch (column.Type) {
    case ConfigFieldType.TypeNumber:
      return Number.isFinite(Number(raw)) ? null : `"${column.Label}" must be a number`
    case ConfigFieldType.TypeBoolean:
      return raw === 'true' || raw === 'false' ? null : `"${column.Label}" must be true or false`
    case ConfigFieldType.TypeOptions:
      return !column.Options || column.Options.length === 0 || column.Options.includes(raw)
        ? null
        : `"${column.Label}" must be one of: ${(column.Options ?? []).join(', ')}`
    default:
      return null
  }
}

// buildMappedRows applies mapping (fileColumn -> target List column
// key, or SKIP_TARGET) to every parsed row, splitting into rows ready
// to import and rows skipped with a human reason -- a Required column
// with no mapped value, or a mapped value that fails its column's
// declared Type, same honest-path rule apply-list-row's own typed
// validation enforces server-side (docs/goals/0070).
export function buildMappedRows(rows: Record<string, string>[], mapping: Record<string, string>, listColumns: Field[]): MappedImport {
  const imported: Record<string, string>[] = []
  const skipped: SkippedRow[] = []

  rows.forEach((row, i) => {
    const values = mapRowValues(row, mapping)

    let reason: string | null = null
    for (const col of listColumns) {
      const v = values[col.Key] ?? ''
      if (col.Required && v === '') {
        reason = `missing a value for required column "${col.Label}"`
        break
      }
      const typeErr = validateTypedValue(col, v)
      if (typeErr) {
        reason = typeErr
        break
      }
    }

    if (reason) {
      skipped.push({ row: i + 1, reason })
    } else {
      imported.push(values)
    }
  })

  return { imported, skipped }
}

export interface InferredField {
  key: string
  label: string
  type: typeof ConfigFieldType[keyof typeof ConfigFieldType]
  options: string[] | null
}

// inferListSchema proposes a typed schema from a parsed file
// (docs/goals/0131): a column is a number when every non-empty value
// parses numeric, a boolean when values stay within true/false, an
// options field when the distinct-value set is small AND genuinely
// repeats (<= 8 distinct, rows >= 2x distinct -- a column of unique
// names must never become an 8-option enum), else text. Empty cells
// never vote. Keys are label slugs, unique within the proposal
// (nextColumnKey's own rules).
export function inferListSchema(parsed: ParsedFile, nextKey: (label: string, existing: string[]) => string): InferredField[] {
  const fields: InferredField[] = []
  const keys: string[] = []
  for (const col of parsed.fileColumns) {
    const values = parsed.rows.map((r) => r[col] ?? '').filter((v) => v !== '')
    const distinct = [...new Set(values)]
    let type: InferredField['type'] = ConfigFieldType.TypeText
    let options: string[] | null = null
    if (values.length > 0 && values.every((v) => Number.isFinite(Number(v)))) {
      type = ConfigFieldType.TypeNumber
    } else if (values.length > 0 && values.every((v) => v === 'true' || v === 'false')) {
      type = ConfigFieldType.TypeBoolean
    } else if (values.length > 0 && distinct.length <= 8 && values.length >= distinct.length * 2) {
      type = ConfigFieldType.TypeOptions
      options = distinct
    }
    const key = nextKey(col, keys)
    keys.push(key)
    fields.push({ key, label: col, type, options })
  }
  return fields
}
