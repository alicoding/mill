import { describe, expect, it } from 'vitest'
import type { TFunction } from 'i18next'
import { daysLeft, formatTrashCaption } from './secretsTrashCaption'

const DAY_MS = 1000 * 60 * 60 * 24
const DELETED_AT = '2026-09-01T00:00:00Z'
const EXPIRES_AT = '2026-10-01T00:00:00Z' // exactly 30 days after DELETED_AT

const now = (ms: number) => Date.parse(DELETED_AT) + ms

describe('daysLeft', () => {
  it('reads 30 the moment an entry is trashed', () => {
    expect(daysLeft(EXPIRES_AT, now(0))).toBe(30)
  })

  it('reads 1 with exactly one day remaining', () => {
    expect(daysLeft(EXPIRES_AT, now(29 * DAY_MS))).toBe(1)
  })

  it('reads 0 at the retention boundary itself', () => {
    expect(daysLeft(EXPIRES_AT, now(30 * DAY_MS))).toBe(0)
  })

  it('never goes negative past the boundary (the sweep should have destroyed it by then)', () => {
    expect(daysLeft(EXPIRES_AT, now(31 * DAY_MS))).toBe(0)
  })

  it('rounds a partial day up, so the count only drops on a whole day crossed', () => {
    expect(daysLeft(EXPIRES_AT, now(1))).toBe(30)
    expect(daysLeft(EXPIRES_AT, now(29 * DAY_MS + 1))).toBe(1)
  })
})

describe('formatTrashCaption', () => {
  const t = ((key: string, params?: Record<string, unknown>) => `${key}:${JSON.stringify(params)}`) as unknown as TFunction<'secrets'>

  it('interpolates both the relative time and the days-left count', () => {
    const result = formatTrashCaption(t, DELETED_AT, EXPIRES_AT, now(29 * DAY_MS))
    expect(result).toContain('"days":1')
    expect(result).toContain('"relative"')
  })
})
