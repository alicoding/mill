import { useEffect, useMemo, useState } from 'react'
import type { Theme } from '@glideapps/glide-data-grid'
import { OPTION_COLOR_PALETTE, type OptionColor } from './projectionColors'

// Primer tokens -> the adopted grid's own theme, read once per mount
// so light and dark both follow the app (the library themes by object,
// not by CSS variables). The option-pill palette is read the same way:
// canvas drawing cannot resolve a CSS variable itself.
export interface GridPalette {
  theme: Partial<Theme>
  pills: Record<OptionColor, { bg: string; fg: string }>
}

export function paletteFromTokens(el: HTMLElement | null): GridPalette {
  const css = el ? getComputedStyle(el) : null
  const v = (name: string, fallback: string) => css?.getPropertyValue(name).trim() || fallback
  const pills = {} as GridPalette['pills']
  for (const color of OPTION_COLOR_PALETTE) {
    pills[color] = { bg: v(`--bgColor-${color}-muted`, '#eaeef2'), fg: v(`--fgColor-${color}`, '#1f2328') }
  }
  return {
    theme: {
      accentColor: v('--bgColor-accent-emphasis', '#0969da'),
      accentLight: v('--bgColor-accent-muted', '#ddf4ff'),
      textDark: v('--fgColor-default', '#1f2328'),
      textMedium: v('--fgColor-muted', '#59636e'),
      textLight: v('--fgColor-disabled', '#8c959f'),
      textHeader: v('--fgColor-muted', '#59636e'),
      bgCell: v('--bgColor-default', '#ffffff'),
      bgCellMedium: v('--bgColor-muted', '#f6f8fa'),
      bgHeader: v('--bgColor-muted', '#f6f8fa'),
      bgHeaderHasFocus: v('--bgColor-accent-muted', '#ddf4ff'),
      bgHeaderHovered: v('--bgColor-neutral-muted', '#eaeef2'),
      borderColor: v('--borderColor-default', '#d1d9e0'),
      horizontalBorderColor: v('--borderColor-muted', '#e5e9ed'),
      fontFamily: v('--fontStack-sansSerif', 'system-ui, sans-serif'),
      baseFontStyle: '12px',
      headerFontStyle: '600 11px',
      cellHorizontalPadding: 8,
    },
    pills,
  }
}

export const GLIDE_ROW_HEIGHT = 28
export const GLIDE_HEADER_HEIGHT = 32
// Compact display density (shared/density.ts) tightens the grid's
// rows the way it tightens card padding and Settings stacks.
export const GLIDE_ROW_HEIGHT_COMPACT = 24
export const GLIDE_HEADER_HEIGHT_COMPACT = 28
export const GLIDE_DEFAULT_COLUMN_WIDTH = 160

// The grid paints on a canvas, so it cannot follow a CSS variable the
// way the rest of the app does: the palette is READ, once, into a theme
// object. Re-read it whenever the applied scheme changes (appearance.ts
// stamps data-mill-scheme / data-mill-theme on the document element),
// or a grid mounted in light stays light after a switch to dark.
export function useGridPalette(el: HTMLElement | null): GridPalette {
  const [scheme, setScheme] = useState(() => appliedScheme())
  useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => setScheme(appliedScheme()))
    observer.observe(root, { attributes: true, attributeFilter: ['data-mill-scheme', 'data-mill-theme'] })
    return () => observer.disconnect()
  }, [])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `scheme` is the whole point: paletteFromTokens reads the document's live computed values, which the rule cannot see as an input
  return useMemo(() => paletteFromTokens(el), [el, scheme])
}

function appliedScheme(): string {
  const root = document.documentElement
  return `${root.dataset.millTheme ?? ''}/${root.dataset.millScheme ?? ''}`
}
