import { describe, expect, it } from 'vitest'
import { accentScale, accentStyleText, hslToHex, parseAccent, rgbToHsl } from './accentScale'

describe('parseAccent', () => {
  it("reads the runtime's own rgb() shape", () => {
    expect(parseAccent('rgb(0,122,255)')).toEqual({ r: 0, g: 122, b: 255 })
    expect(parseAccent('rgb(31, 111, 107)')).toEqual({ r: 31, g: 111, b: 107 })
  })

  it('reads a hex literal, long and short', () => {
    expect(parseAccent('#1F6F6B')).toEqual({ r: 31, g: 111, b: 107 })
    expect(parseAccent('#abc')).toEqual({ r: 170, g: 187, b: 204 })
  })

  it('rejects anything else, including the empty string server mode returns', () => {
    expect(parseAccent('')).toBeNull()
    expect(parseAccent('controlAccentColor')).toBeNull()
    expect(parseAccent('rgb(300,0,0)')).toBeNull()
  })
})

describe('the hue/saturation round trip', () => {
  it('returns the color it was given', () => {
    for (const hex of ['#1f6f6b', '#0a84ff', '#ff375f', '#8944ab', '#3fa39e']) {
      expect(hslToHex(rgbToHsl(parseAccent(hex)!))).toBe(hex)
    }
  })

  it('reads a grey as fully desaturated', () => {
    expect(rgbToHsl({ r: 128, g: 128, b: 128 }).s).toBe(0)
  })
})

describe('accentScale', () => {
  // The teal IS the scale's definition, so feeding it back in has to
  // reproduce it -- the property that makes the lightness steps a
  // faithful description of today's look rather than an approximation.
  it("reproduces Mill's own teal when handed Mill's own teal", () => {
    expect(accentScale('#1F6F6B', 'light').emphasis).toBe('#1f6f6b')
    expect(accentScale('#3FA39E', 'dark').fg).toBe('#3fa39e')
  })

  it('keeps the built-in teal when the platform reports no accent', () => {
    expect(accentScale('', 'light')).toEqual({
      emphasis: '#1F6F6B',
      fg: '#1F6F6B',
      muted: '#DAF3F1',
      borderMuted: '#4FB3AC66',
    })
    expect(accentScale('', 'dark')).toEqual({
      emphasis: '#2B7D77',
      fg: '#3FA39E',
      muted: '#3FA39E1a',
      borderMuted: '#3FA39E66',
    })
  })

  it('keeps the accent hue and lands on the light steps', () => {
    const blue = accentScale('rgb(0,122,255)', 'light')
    const hue = rgbToHsl(parseAccent(blue.emphasis)!).h
    expect(Math.round(hue)).toBe(Math.round(rgbToHsl({ r: 0, g: 122, b: 255 }).h))
    // Light emphasis sits at the teal's own lightness, a dark fill that
    // carries white content -- not the bright accent it came from.
    expect(rgbToHsl(parseAccent(blue.emphasis)!).l).toBeCloseTo(rgbToHsl(parseAccent('#1F6F6B')!).l, 2)
    // The muted tint is the pale step, and the border keeps its alpha.
    expect(rgbToHsl(parseAccent(blue.muted)!).l).toBeCloseTo(rgbToHsl(parseAccent('#DAF3F1')!).l, 2)
    expect(blue.borderMuted).toMatch(/^#[0-9a-f]{6}66$/)
  })

  it('splits fill from text in dark mode, as the audited teal does', () => {
    const dark = accentScale('rgb(0,122,255)', 'dark')
    expect(dark.emphasis).not.toBe(dark.fg)
    expect(rgbToHsl(parseAccent(dark.fg)!).l).toBeGreaterThan(rgbToHsl(parseAccent(dark.emphasis)!).l)
    expect(dark.muted).toBe(`${dark.fg}1a`)
    expect(dark.borderMuted).toBe(`${dark.fg}66`)
  })
})

describe('accentStyleText', () => {
  it('keys both blocks on the resolved theme attribute', () => {
    const css = accentStyleText('rgb(0,122,255)')
    expect(css).toContain(':root, [data-mill-theme="light"][data-mill-scheme] {')
    expect(css).toContain('[data-mill-theme="dark"][data-mill-scheme] {')
    expect(css).toContain('--mill-accent-emphasis:')
    expect(css).toContain('--mill-accent-border-muted:')
  })
})

// applyAccent's own DOM write (one <style> element, refreshed in place)
// is proven live in e2e/theming.spec.ts -- the unit suite has no DOM.
describe('the no-accent stylesheet', () => {
  it("carries Mill's own teal, unchanged", () => {
    const css = accentStyleText('')
    expect(css).toContain('#1F6F6B')
    expect(css).toContain('#3FA39E')
  })
})
