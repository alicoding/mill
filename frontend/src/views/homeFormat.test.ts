import { describe, expect, it } from 'vitest'
import { formatMinutes } from './homeFormat'
import views from '../locales/en/views.json'

// A minimal stand-in for react-i18next's t() -- same pattern
// composition/validationCopy.test.ts uses, resolving the real English
// strings from views.json rather than pulling react-i18next's
// provider/hook machinery into a non-component test.
function t(key: string, vars: Record<string, unknown> = {}): string {
  const value = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], views)
  if (typeof value !== 'string') throw new Error(`missing views.json key: ${key}`)
  return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(vars[name] ?? ''))
}

describe('formatMinutes', () => {
  it('renders under an hour as plain minutes', () => {
    expect(formatMinutes(t, 0)).toBe('0 min')
    expect(formatMinutes(t, 45)).toBe('45 min')
    expect(formatMinutes(t, 59)).toBe('59 min')
  })

  it('renders an hour or more as hours, one decimal place under 10 hours', () => {
    expect(formatMinutes(t, 60)).toBe('1.0 hrs')
    expect(formatMinutes(t, 90)).toBe('1.5 hrs')
    expect(formatMinutes(t, 125)).toBe('2.1 hrs') // docs/goals/0014's own example figure
  })

  it('renders 10 hours or more with no decimal place', () => {
    expect(formatMinutes(t, 600)).toBe('10 hrs')
    expect(formatMinutes(t, 725)).toBe('12 hrs')
  })
})
