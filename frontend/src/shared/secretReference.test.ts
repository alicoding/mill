import { describe, expect, it } from 'vitest'
import { toEntryID, toReference } from './secretReference'

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
