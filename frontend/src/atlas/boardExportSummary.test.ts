import { describe, expect, it } from 'vitest'
import type { TFunction } from 'i18next'
import type { BoardDrawioExport } from '../../bindings/github.com/alicoding/mill/internal/services/atlassvc/models'
import { boardExportSummaryText } from './boardExportSummary'

const t = ((key: string, opts?: Record<string, unknown>) => (opts ? `${key}:${JSON.stringify(opts)}` : key)) as TFunction<'atlas'>

function result(overrides: Partial<BoardDrawioExport> = {}): BoardDrawioExport {
  return { XML: '', Cards: 0, Links: 0, Shapes: 0, Pages: 1, Skipped: null, ...overrides }
}

describe('boardExportSummaryText', () => {
  it('reports only the nonzero converted counts when nothing was skipped', () => {
    const text = boardExportSummaryText(t, result({ Cards: 2, Links: 1 }))
    expect(text).toBe('boardExport.converted:{"what":"boardExport.cards:{\\"count\\":2}, boardExport.links:{\\"count\\":1}"}')
  })

  it('includes shapes when present', () => {
    const text = boardExportSummaryText(t, result({ Cards: 1, Shapes: 3 }))
    expect(text).toContain('boardExport.shapes:{\\"count\\":3}')
  })

  // A skipped board object (ink/image/freeform arrow, an unreadable or
  // non-draw.io diagram mirror) is always named, never dropped silently.
  it('appends what was skipped and why, never dropping it silently', () => {
    const text = boardExportSummaryText(t, result({ Cards: 2, Skipped: ['Sketch (ink)'] }))
    expect(text).toContain('boardExport.skipped:{"count":1,"items":"Sketch (ink)"}')
  })

  it('joins multiple skipped item names into one message', () => {
    const text = boardExportSummaryText(t, result({ Skipped: ['Sketch (ink)', 'Arrow (freeform arrow)'] }))
    expect(text).toContain('"count":2')
    expect(text).toContain('"items":"Sketch (ink), Arrow (freeform arrow)"')
  })
})
