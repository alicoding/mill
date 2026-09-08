import { describe, expect, it } from 'vitest'
import { formatPluginDate } from './pluginDateFormat'

describe('formatPluginDate', () => {
  it('relative reads recent-past phrasing', () => {
    const iso = new Date(Date.now() - 2 * 60 * 1000).toISOString()
    expect(formatPluginDate(iso, 'relative')).toBe('2 minutes ago')
  })

  it('defaults to relative when no style is given', () => {
    const iso = new Date(Date.now() - 2 * 60 * 1000).toISOString()
    expect(formatPluginDate(iso)).toBe('2 minutes ago')
  })

  it('short is a locale date with no time', () => {
    const iso = '2026-03-01T12:00:00Z'
    expect(formatPluginDate(iso, 'short')).toBe(new Date(iso).toLocaleDateString())
  })

  it('long is a locale date and time', () => {
    const iso = '2026-03-01T12:00:00Z'
    expect(formatPluginDate(iso, 'long')).toBe(new Date(iso).toLocaleString())
  })

  it('answers an em dash for an unparseable timestamp', () => {
    expect(formatPluginDate('not a date', 'relative')).toBe('—')
    expect(formatPluginDate('', 'short')).toBe('—')
  })
})
