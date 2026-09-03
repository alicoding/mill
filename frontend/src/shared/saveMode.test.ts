import { describe, expect, it } from 'vitest'
import { modeFromStored } from './saveMode'

describe('saveMode (goal 0295 S2b)', () => {
  it('reads only the exact explicit marker as explicit; anything else is automatic', () => {
    expect(modeFromStored('explicit')).toBe('explicit')
    expect(modeFromStored('automatic')).toBe('automatic')
    expect(modeFromStored('')).toBe('automatic')
    expect(modeFromStored(null)).toBe('automatic')
    expect(modeFromStored('EXPLICIT')).toBe('automatic')
  })
})
