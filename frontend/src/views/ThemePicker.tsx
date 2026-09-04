import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList } from '@primer/react'
import { dispatchThemePreview, getThemePreview, subscribeThemePreview } from '../shared/appearancePreview'
import { pluginThemes, subscribePluginThemes, type PluginThemeEntry } from '../shared/appearanceThemes'
import type { ResolvedMode } from '../shared/appearance'
import styles from './ThemePicker.module.css'

// One family's theme list (goal 0342). Every theme Mill can paint in
// that family, built-in and contributed alike, in one radio list:
// pointing at a row paints the window in it, clicking keeps it, and
// leaving the list or pressing Escape puts the previous one back.
//
// A picker holds ONE family. Which pickers exist is the mode's answer,
// not this component's: AppearanceSection renders one under a fixed
// Light or Dark, and two under Match system.

// SWATCH_TOKENS are the three that read a palette at a glance: the
// page behind everything, the text on it, and the accent that carries
// every link and selected state.
const SWATCH_TOKENS = ['--bgColor-default', '--fgColor-default', '--fgColor-accent'] as const

export interface ThemeOption {
  scheme: string
  label: string
  pluginName?: string
}

// readSwatches paints each scheme onto one hidden probe and reads the
// tokens back off it. Reading the real cascade is the only honest
// source: a contributed theme's colors exist nowhere but the
// stylesheet the host injected for it, and a built-in scheme's live in
// Primer's own files rather than in any value this bundle holds.
function readSwatches(family: ResolvedMode, schemes: readonly string[]): Record<string, string[]> {
  const probe = document.createElement('div')
  probe.setAttribute('aria-hidden', 'true')
  probe.className = styles.probe
  document.body.append(probe)
  const out: Record<string, string[]> = {}
  try {
    for (const scheme of schemes) {
      probe.dataset.colorMode = family
      probe.dataset.lightTheme = family === 'light' ? scheme : 'light'
      probe.dataset.darkTheme = family === 'dark' ? scheme : 'dark'
      probe.dataset.millTheme = family
      probe.dataset.millScheme = scheme
      const style = getComputedStyle(probe)
      out[scheme] = SWATCH_TOKENS.map((token) => style.getPropertyValue(token).trim())
    }
  } finally {
    probe.remove()
  }
  return out
}

export function ThemePicker({ family, options, value, labelId, testId, onCommit }: {
  family: ResolvedMode
  options: ThemeOption[]
  value: string
  labelId: string
  testId: string
  onCommit: (scheme: string) => void
}) {
  const { t } = useTranslation('views')
  const schemes = options.map((o) => o.scheme).join(' ')
  const preview = useSyncExternalStore(subscribeThemePreview, getThemePreview, nullPreview)
  const [swatches, setSwatches] = useState<Record<string, string[]>>({})
  useEffect(() => {
    setSwatches(readSwatches(family, schemes.split(' ')))
  }, [family, schemes])

  // Escape is bound on the window rather than on the list: a pointer
  // preview never moves focus, so a handler on this subtree would
  // never see the key that is supposed to cancel it.
  useEffect(() => {
    if (preview === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dispatchThemePreview({ kind: 'cancel' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [preview])

  // The remaining preview handlers sit on the wrapper, not on the
  // list: leaving by pointer and tabbing out are one question -- is
  // the pointer or the focus still inside this control.
  return (
    <div
      className={styles.wrap}
      onMouseLeave={() => dispatchThemePreview({ kind: 'leave' })}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) dispatchThemePreview({ kind: 'leave' })
      }}
    >
      <span role="status" aria-label={t('settings.theme.previewLabel')} className={styles.announce}>
        {preview !== null && preview.family === family ? labelFor(options, preview.scheme) : ''}
      </span>
      {/* role="listbox" is what turns the kit's list into a real radio
          group: its items become options with aria-selected, and the
          kit's own focus zone takes over the arrow keys, which is what
          makes arrowing preview. */}
      <ActionList role="listbox" selectionVariant="single" aria-labelledby={labelId} data-testid={testId} className={styles.list}>
      {options.map((option) => (
        <ActionList.Item
          key={option.scheme}
          selected={option.scheme === value}
          data-testid={`${testId}-option-${option.scheme}`}
          onMouseEnter={() => dispatchThemePreview({ kind: 'point', family, scheme: option.scheme })}
          onFocus={() => dispatchThemePreview({ kind: 'point', family, scheme: option.scheme })}
          onSelect={() => {
            dispatchThemePreview({ kind: 'commit' })
            onCommit(option.scheme)
          }}
        >
          <ActionList.LeadingVisual>
            <span className={styles.swatch} aria-hidden="true">
              {(swatches[option.scheme] ?? ['', '', '']).map((color, i) => (
                <span key={SWATCH_TOKENS[i]} className={styles.chip} style={{ background: color }} />
              ))}
            </span>
          </ActionList.LeadingVisual>
          {option.label}
          {option.pluginName && (
            <ActionList.Description>{t('settings.theme.fromPlugin', { plugin: option.pluginName })}</ActionList.Description>
          )}
        </ActionList.Item>
      ))}
      </ActionList>
    </div>
  )
}

// useThemeOptions joins one family's built-in schemes with every theme
// a running plugin contributes, in that order: what Mill ships first,
// what the user installed after it.
export function useThemeOptions(family: ResolvedMode, builtIn: readonly string[], labelOf: (scheme: string) => string): ThemeOption[] {
  const contributed = useSyncExternalStore(subscribePluginThemes, pluginThemes, emptyThemes)
  return useMemo(() => [
    ...builtIn.map((scheme) => ({ scheme, label: labelOf(scheme) })),
    ...contributed.filter((c: PluginThemeEntry) => c.family === family).map((c: PluginThemeEntry) => ({ scheme: c.schemeId, label: c.label, pluginName: c.pluginName })),
  ], [family, builtIn, contributed, labelOf])
}

function nullPreview(): null {
  return null
}

// The previewed theme is announced rather than only painted: a
// keyboard user arrowing the list sees the window change but would
// otherwise never be told which theme they are on.
function labelFor(options: ThemeOption[], scheme: string): string {
  return options.find((o) => o.scheme === scheme)?.label ?? ''
}

const EMPTY: PluginThemeEntry[] = []
function emptyThemes(): PluginThemeEntry[] {
  return EMPTY
}
