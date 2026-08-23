import { afterEach, describe, expect, it, vi } from 'vitest'
import { Type as ConfigFieldType } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import type { Field } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'

const parseXlsxFileMock = vi.hoisted(() => vi.fn())
vi.mock('../shared/bindings', () => ({
  ConfigureService: { ParseXlsxFile: parseXlsxFileMock },
}))

import { SKIP_TARGET, autoMatchColumns, buildMappedRows, parseImportFile, parseUploadedFile } from './listRowImportParse'

function field(overrides: Partial<Field>): Field {
  return {
    Key: '', Label: '', Type: ConfigFieldType.TypeText, Required: false, Default: '', Description: '',
    Options: null, Suggestions: null, Secret: false, RefKind: '', Multiline: false, SystemManaged: false,
    ...overrides,
  }
}

describe('parseImportFile', () => {
  it('parses a CSV file with a header row', () => {
    const result = parseImportFile('rows.csv', 'task,status\nShip it,In progress\nReview,Done\n')
    expect(result.fileColumns).toEqual(['task', 'status'])
    expect(result.rows).toEqual([
      { task: 'Ship it', status: 'In progress' },
      { task: 'Review', status: 'Done' },
    ])
  })

  it('parses a JSON array of flat objects, stringifying non-string values', () => {
    const result = parseImportFile('rows.json', JSON.stringify([{ task: 'Ship it', count: 3, done: true }]))
    expect(result.fileColumns).toEqual(['task', 'count', 'done'])
    expect(result.rows).toEqual([{ task: 'Ship it', count: '3', done: 'true' }])
  })

  it('rejects a JSON file that is not an array', () => {
    expect(() => parseImportFile('rows.json', JSON.stringify({ task: 'x' }))).toThrow(/array/)
  })

  it('rejects a JSON array containing a non-object entry', () => {
    expect(() => parseImportFile('rows.json', JSON.stringify(['x']))).toThrow(/plain object/)
  })

  it('rejects malformed JSON with a readable message', () => {
    expect(() => parseImportFile('rows.json', '{not json')).toThrow(/JSON or CSV/)
  })
})

describe('autoMatchColumns', () => {
  it('matches file columns to List columns by Key or Label, case-insensitively', () => {
    const columns = [field({ Key: 'task', Label: 'Task' }), field({ Key: 'status', Label: 'Status' })]
    const mapping = autoMatchColumns(['Task', 'STATUS', 'owner'], columns)
    expect(mapping).toEqual({ Task: 'task', STATUS: 'status', owner: SKIP_TARGET })
  })
})

describe('buildMappedRows', () => {
  const columns = [
    field({ Key: 'task', Label: 'Task', Required: true }),
    field({ Key: 'count', Label: 'Count', Type: ConfigFieldType.TypeNumber }),
  ]

  it('imports rows whose mapped values satisfy every column rule', () => {
    const rows = [{ Task: 'Ship it', Count: '3' }]
    const mapping = { Task: 'task', Count: 'count' }
    const { imported, skipped } = buildMappedRows(rows, mapping, columns)
    expect(imported).toEqual([{ task: 'Ship it', count: '3' }])
    expect(skipped).toEqual([])
  })

  it('skips a row missing a required column value, naming the row and reason', () => {
    const rows = [{ Task: '', Count: '3' }]
    const mapping = { Task: 'task', Count: 'count' }
    const { imported, skipped } = buildMappedRows(rows, mapping, columns)
    expect(imported).toEqual([])
    expect(skipped).toEqual([{ row: 1, reason: 'missing a value for required column "Task"' }])
  })

  it('skips a row whose value fails its column type, naming the row and reason', () => {
    const rows = [{ Task: 'Ship it', Count: 'not-a-number' }]
    const mapping = { Task: 'task', Count: 'count' }
    const { imported, skipped } = buildMappedRows(rows, mapping, columns)
    expect(imported).toEqual([])
    expect(skipped).toEqual([{ row: 1, reason: '"Count" must be a number' }])
  })

  it('never maps a column set to SKIP_TARGET', () => {
    const rows = [{ Task: 'Ship it', Extra: 'ignored' }]
    const mapping = { Task: 'task', Extra: SKIP_TARGET }
    const { imported } = buildMappedRows(rows, mapping, columns)
    expect(imported).toEqual([{ task: 'Ship it' }])
  })

  it('numbers skipped rows against their own position, not just count', () => {
    const rows = [{ Task: 'Good' }, { Task: '' }]
    const mapping = { Task: 'task' }
    const { skipped } = buildMappedRows(rows, mapping, columns)
    expect(skipped).toEqual([{ row: 2, reason: 'missing a value for required column "Task"' }])
  })
})

// parseUploadedFile's own extension-dispatch: .xlsx routes through the
// Go-side excelize parser (mocked here; ParseXlsxFile's real parsing is
// Go-tested in configurelist_xlsximport_test.go), everything else stays
// on parseImportFile's existing text path.
describe('parseUploadedFile', () => {
  afterEach(() => {
    parseXlsxFileMock.mockReset()
  })

  it('sends an .xlsx file to ConfigureService.ParseXlsxFile and normalizes its nullable shape', async () => {
    parseXlsxFileMock.mockResolvedValueOnce({
      FileColumns: ['task', 'status'],
      Rows: [{ task: 'Ship it', status: 'Done' }, null],
    })
    const file = new File(['irrelevant -- bytes never inspected by the mock'], 'rows.xlsx')

    const result = await parseUploadedFile(file)

    expect(parseXlsxFileMock).toHaveBeenCalledTimes(1)
    expect(result.fileColumns).toEqual(['task', 'status'])
    expect(result.rows).toEqual([{ task: 'Ship it', status: 'Done' }, {}])
  })

  it('normalizes an entirely-null xlsx result to empty columns/rows rather than throwing', async () => {
    parseXlsxFileMock.mockResolvedValueOnce({ FileColumns: null, Rows: null })
    const file = new File(['x'], 'empty.xlsx')

    const result = await parseUploadedFile(file)

    expect(result).toEqual({ fileColumns: [], rows: [] })
  })

  it('routes a non-xlsx file through the existing text-based parseImportFile path, never calling ParseXlsxFile', async () => {
    const file = new File(['task,status\nShip it,Done\n'], 'rows.csv')

    const result = await parseUploadedFile(file)

    expect(parseXlsxFileMock).not.toHaveBeenCalled()
    expect(result).toEqual(parseImportFile('rows.csv', 'task,status\nShip it,Done\n'))
  })

  it('propagates a ParseXlsxFile rejection as the returned promise rejection', async () => {
    parseXlsxFileMock.mockRejectedValueOnce(new Error('parse xlsx: open: not a valid workbook'))
    const file = new File(['not really xlsx bytes'], 'broken.xlsx')

    await expect(parseUploadedFile(file)).rejects.toThrow(/not a valid workbook/)
  })
})
