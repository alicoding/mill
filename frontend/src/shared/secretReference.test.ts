import { describe, expect, it } from 'vitest'
import { parseSourceRef, toEntryID, toReference } from './secretReference'

// The two shapes a picked secret takes (goal 0306): a Configure
// entity's field holds a REFERENCE, while the title cache and a
// plugin's secretRef setting are keyed by the bare entry id. A
// provider-qualified id is already a reference and must survive both
// directions untouched, or a source-backed pick would silently become
// a vault lookup for an id that does not exist.
describe('secret reference conversion', () => {
  it('qualifies a bare vault id and leaves an empty pick empty', () => {
    expect(toReference('abc')).toBe('vault:abc')
    expect(toReference('')).toBe('')
  })

  it('leaves a provider-qualified id exactly as it is, both ways', () => {
    expect(toReference('env:proj/API_TOKEN')).toBe('env:proj/API_TOKEN')
    expect(toEntryID('env:proj/API_TOKEN')).toBe('env:proj/API_TOKEN')
  })

  it('strips the vault prefix back off, and round-trips', () => {
    expect(toEntryID('vault:abc')).toBe('abc')
    expect(toEntryID(toReference('abc'))).toBe('abc')
    expect(toReference(toEntryID('vault:abc'))).toBe('vault:abc')
  })
})

// goal 0408 S1: the picker's own unresolved-caption logic parses a
// provider-qualified id into its source and key WITHOUT a round trip,
// so it can name which source and key a reference points at even when
// that key is no longer in the titles cache.
describe('parseSourceRef', () => {
  it('splits a provider-qualified id into its source and key', () => {
    expect(parseSourceRef('env:proj-env/API_TOKEN')).toEqual({ sourceID: 'proj-env', key: 'API_TOKEN' })
  })

  it('keeps only the first "/" as the split point, for a key that itself contains one', () => {
    expect(parseSourceRef('bruno:gazette/path/to/KEY')).toEqual({ sourceID: 'gazette', key: 'path/to/KEY' })
  })

  it('is null for a bare vault id, an empty pick, and a malformed reference', () => {
    expect(parseSourceRef('abc')).toBeNull()
    expect(parseSourceRef('')).toBeNull()
    expect(parseSourceRef('env:no-slash')).toBeNull()
    expect(parseSourceRef('env:/KEY')).toBeNull()
    expect(parseSourceRef('env:proj-env/')).toBeNull()
  })
})
