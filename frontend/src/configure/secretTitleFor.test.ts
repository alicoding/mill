import { describe, expect, it } from 'vitest'
import { secretTitleFor } from './secretTitleFor'

// An entry created from a field is named after the thing it belongs to
// and the field it fills (goal 0306), matching what the Go adoption
// pass writes -- so entries created either way read the same in the
// store's list.
describe('secretTitleFor', () => {
  it('names the entry after the entity and the field', () => {
    expect(secretTitleFor('Payments API', 'Secret')).toBe('Payments API: secret')
  })

  it('falls back to the field alone before the entity has a name', () => {
    expect(secretTitleFor('  ', 'Consumer secret')).toBe('consumer secret')
  })
})
