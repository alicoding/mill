import { describe, expect, it } from 'vitest'
import { fuzzyMatches, fuzzyScore } from './fuzzyFilter'

describe('fuzzyScore', () => {
  it('scores an exact match at the top of the range', () => {
    expect(fuzzyScore('alpha', 'alpha')).toBeCloseTo(1, 5)
  })

  it('returns undefined when the query is not a subsequence of the text', () => {
    expect(fuzzyScore('zzz', 'alpha')).toBeUndefined()
  })

  it('scores a word-initial abbreviation above the floor', () => {
    expect(fuzzyScore('ows', 'open workflow settings')).toBeGreaterThanOrEqual(0.3)
  })
})

describe('fuzzyMatches', () => {
  it('matches everything for an empty query', () => {
    expect(fuzzyMatches('', 'alpha')).toBe(true)
  })

  it('matches a plain substring', () => {
    expect(fuzzyMatches('lph', 'alpha')).toBe(true)
  })

  it('matches a typo\'d query a substring test would miss', () => {
    // A dropped letter ("wrkflow") is still a subsequence of
    // "workflow" in order, so a plain .includes() misses it but
    // fuzzyMatches finds it.
    expect('workflow'.includes('wrkflow')).toBe(false)
    expect(fuzzyMatches('wrkflow', 'workflow')).toBe(true)
  })

  it('rejects scattered-letter noise', () => {
    expect(fuzzyMatches('wqx', 'zoom out to fit board contents')).toBe(false)
  })
})
