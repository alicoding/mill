import { describe, expect, it } from 'vitest'
import { Type as FieldType } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import { nextColumnKey } from '../shared/projectionColumns'
import { inferListSchema, parseImportFile } from './listRowImportParse'

const infer = (fileName: string, text: string) => inferListSchema(parseImportFile(fileName, text), nextColumnKey)

describe('inferListSchema', () => {
  it('proposes number when every non-empty value parses numeric', () => {
    const fields = infer('a.csv', 'Qty,Name\n1,ada\n2.5,bob\n,carol')
    expect(fields[0]).toMatchObject({ key: 'qty', label: 'Qty', type: FieldType.TypeNumber })
    expect(fields[1].type).toBe(FieldType.TypeText)
  })

  it('proposes boolean only for pure true/false columns', () => {
    const fields = infer('a.csv', 'Done,Note\ntrue,x\nfalse,y\ntrue,z')
    expect(fields[0].type).toBe(FieldType.TypeBoolean)
    expect(fields[1].type).toBe(FieldType.TypeText)
  })

  it('proposes options only when a small distinct set genuinely repeats', () => {
    const repeats = infer('a.csv', 'Status\nopen\nclosed\nopen\nclosed\nopen\nclosed')
    expect(repeats[0].type).toBe(FieldType.TypeOptions)
    expect(repeats[0].options).toEqual(['open', 'closed'])
    // 3 rows, 3 distinct: unique values stay text, never a 3-option enum.
    const unique = infer('a.csv', 'Name\nada\nbob\ncarol')
    expect(unique[0].type).toBe(FieldType.TypeText)
    expect(unique[0].options).toBeNull()
  })

  it('treats an all-empty column as text and slugs colliding labels uniquely', () => {
    const fields = infer('a.json', JSON.stringify([
      { 'Item Name': 'a', 'item name': 'b', Blank: '' },
      { 'Item Name': 'c', 'item name': 'd', Blank: '' },
    ]))
    expect(fields.map((f) => f.key)).toEqual(['item-name', 'item-name-2', 'blank'])
    expect(fields[2].type).toBe(FieldType.TypeText)
  })
})
