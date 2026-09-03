import { describe, expect, it } from 'vitest'
import { TABLE_MAX_WIDTH, TABLE_WIDTH } from './atlasBoardLayout'
import { tableWidthForColumns } from './atlasTableWidth'

describe('tableWidthForColumns', () => {
  it('holds the default width for a few columns, widens per column, and caps', () => {
    expect(tableWidthForColumns(0)).toBe(TABLE_WIDTH)
    expect(tableWidthForColumns(3)).toBe(TABLE_WIDTH)
    expect(tableWidthForColumns(5)).toBeGreaterThan(TABLE_WIDTH)
    expect(tableWidthForColumns(6)).toBeGreaterThan(tableWidthForColumns(5))
    expect(tableWidthForColumns(20)).toBe(TABLE_MAX_WIDTH)
  })
})
