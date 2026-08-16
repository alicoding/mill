import { describe, expect, it } from 'vitest'
import { Type as ConfigFieldType } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import type { Field } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import { SKIP_TARGET, autoMatchColumns, buildMappedRows, parseImportFile } from './listRowImportParse'

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
