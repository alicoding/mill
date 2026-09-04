import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DARK_SCHEMES,
  LIGHT_SCHEMES,
  applyAppearance,
  highContrastPair,
  normalizeMode,
  resolveSchemes,
  type Appearance,
} from './appearance'

const THEMES_DIR = path.resolve(__dirname, '../../node_modules/@primer/primitives/dist/css/functional/themes')
const MAIN = readFileSync(path.resolve(__dirname, '../app/main.tsx'), 'utf8')
const BOOT = readFileSync(path.resolve(__dirname, '../../public/color-mode-boot.js'), 'utf8')

// A scheme id IS the Primer attribute value, and the stylesheet that
// paints it is the file of the same name with underscores as dashes.
function themeFileFor(scheme: string): string {
  return `${scheme.replace(/_/g, '-')}.css`
}

describe('every offered scheme has a stylesheet, imported', () => {
  const every = [...LIGHT_SCHEMES, ...DARK_SCHEMES]
  it.each(every)('%s', (scheme) => {
    const file = themeFileFor(scheme)
    expect(existsSync(path.join(THEMES_DIR, file)), `${file} ships with @primer/primitives`).toBe(true)
    expect(MAIN, `main.tsx imports ${file}`).toContain(`themes/${file}'`)
  })

  // Dimmed's high-contrast pair is never listed in Settings, so nothing
  // above would catch its stylesheet going missing.
  it('imports the pair Settings never lists', () => {
    expect(MAIN).toContain("themes/dark-dimmed-high-contrast.css'")
  })
})

// The first-paint script repeats this module's resolution in plain JS
// (it runs before the module graph exists). Nothing but these two lists
// and the pairing is shared, so this is where they are held in step.
describe('the first-paint boot script knows the same schemes', () => {
  it.each([...LIGHT_SCHEMES, ...DARK_SCHEMES])('%s', (scheme) => {
    expect(BOOT).toContain(`'${scheme}'`)
  })

  it('carries the same high-contrast pairing', () => {
    for (const scheme of [...LIGHT_SCHEMES, ...DARK_SCHEMES]) {
      const pair = highContrastPair(scheme)
      if (pair !== scheme) expect(BOOT).toContain(`${scheme}: '${pair}'`)
    }
  })
})

describe('the high-contrast pair', () => {
  it('maps each ordinary scheme to its high-contrast counterpart', () => {
    expect(highContrastPair('light')).toBe('light_high_contrast')
    expect(highContrastPair('dark')).toBe('dark_high_contrast')
    expect(highContrastPair('dark_dimmed')).toBe('dark_dimmed_high_contrast')
    expect(highContrastPair('light_tritanopia')).toBe('light_tritanopia_high_contrast')
    expect(highContrastPair('dark_colorblind')).toBe('dark_colorblind_high_contrast')
  })

  it('leaves an already-high-contrast scheme alone', () => {
    expect(highContrastPair('light_high_contrast')).toBe('light_high_contrast')
    expect(highContrastPair('dark_tritanopia_high_contrast')).toBe('dark_tritanopia_high_contrast')
  })

  it('has a stylesheet for every pair it names', () => {
    for (const scheme of [...LIGHT_SCHEMES, ...DARK_SCHEMES]) {
      expect(existsSync(path.join(THEMES_DIR, themeFileFor(highContrastPair(scheme))))).toBe(true)
    }
  })
})

describe('resolving the system contrast preference', () => {
  const chosen: Appearance = { mode: 'auto', lightScheme: 'light_colorblind', darkScheme: 'dark_dimmed' }

  it('keeps the chosen schemes when the system asks for no extra contrast', () => {
    expect(resolveSchemes(chosen, false)).toEqual({ lightTheme: 'light_colorblind', darkTheme: 'dark_dimmed' })
  })

  it('upgrades both halves under Match system when the system asks for more', () => {
    expect(resolveSchemes(chosen, true)).toEqual({
      lightTheme: 'light_colorblind_high_contrast',
      darkTheme: 'dark_dimmed_high_contrast',
    })
  })

  it('never overrides an explicit Light or Dark choice', () => {
    const explicit: Appearance = { ...chosen, mode: 'dark' }
    expect(resolveSchemes(explicit, true)).toEqual({ lightTheme: 'light_colorblind', darkTheme: 'dark_dimmed' })
  })
})

describe('normalizeMode', () => {
  it("collapses Primer's day/night vocabulary onto light/dark", () => {
    expect(normalizeMode('night')).toBe('dark')
    expect(normalizeMode('dark')).toBe('dark')
    expect(normalizeMode('day')).toBe('light')
    expect(normalizeMode('light')).toBe('light')
    expect(normalizeMode(undefined)).toBe('light')
  })
})

// The DOM write itself is proven live (e2e/theming.spec.ts); what this
// layer proves is which value lands on which attribute, over a minimal
// stand-in root -- the unit suite has no DOM environment.
function stubRoot(): HTMLElement {
  return { dataset: {} as DOMStringMap, style: {} as CSSStyleDeclaration } as HTMLElement
}

describe('applyAppearance', () => {
  it('writes all five attributes plus color-scheme', () => {
    const root = stubRoot()
    applyAppearance(root, { mode: 'auto', lightTheme: 'light', darkTheme: 'dark_dimmed', resolvedMode: 'dark' })
    expect(root.dataset.colorMode).toBe('auto')
    expect(root.dataset.lightTheme).toBe('light')
    expect(root.dataset.darkTheme).toBe('dark_dimmed')
    expect(root.dataset.millTheme).toBe('dark')
    expect(root.dataset.millScheme).toBe('dark_dimmed')
    expect(root.style.colorScheme).toBe('dark')
  })

  it('names the light scheme when the resolved mode is light', () => {
    const root = stubRoot()
    applyAppearance(root, { mode: 'light', lightTheme: 'light_high_contrast', darkTheme: 'dark', resolvedMode: 'light' })
    expect(root.dataset.millScheme).toBe('light_high_contrast')
  })
})

describe('a contributed scheme whose plugin is gone', () => {
  it('is stored as chosen but resolves to the family default', () => {
    const stored = { mode: 'auto' as const, lightScheme: 'p.sepia', darkScheme: 'p.slate' }
    expect(resolveSchemes(stored, false, [])).toEqual({ lightTheme: 'light', darkTheme: 'dark' })
  })

  it('resolves to itself while its plugin is installed', () => {
    const stored = { mode: 'auto' as const, lightScheme: 'p.sepia', darkScheme: 'p.slate' }
    expect(resolveSchemes(stored, false, ['p.sepia', 'p.slate'])).toEqual({ lightTheme: 'p.sepia', darkTheme: 'p.slate' })
  })
})
