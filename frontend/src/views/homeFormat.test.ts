import { describe, expect, it } from 'vitest'
import { formatMinutes } from './homeFormat'

describe('formatMinutes', () => {
  it('renders under an hour as plain minutes', () => {
    expect(formatMinutes(0)).toBe('0 min')
    expect(formatMinutes(45)).toBe('45 min')
    expect(formatMinutes(59)).toBe('59 min')
  })

  it('renders an hour or more as hours, one decimal place under 10 hours', () => {
    expect(formatMinutes(60)).toBe('1.0 hrs')
    expect(formatMinutes(90)).toBe('1.5 hrs')
    expect(formatMinutes(125)).toBe('2.1 hrs') // docs/goals/0014's own example figure
  })

  it('renders 10 hours or more with no decimal place', () => {
    expect(formatMinutes(600)).toBe('10 hrs')
    expect(formatMinutes(725)).toBe('12 hrs')
  })
})
