import { TABLE_MAX_WIDTH, TABLE_WIDTH } from './atlasBoardLayout'

// tableWidthForColumns -- an unsized table's width from its column
// count (goal 0286): TABLE_WIDTH until the columns need more, then
// wider per column up to TABLE_MAX_WIDTH. Estimated per column, not
// measured -- measuring would be intrinsic sizing by another name.
const TABLE_COLUMN_WIDTH = 140
const TABLE_GUTTER = 24
export function tableWidthForColumns(columnCount: number): number {
  return Math.min(TABLE_MAX_WIDTH, Math.max(TABLE_WIDTH, TABLE_GUTTER + columnCount * TABLE_COLUMN_WIDTH))
}
