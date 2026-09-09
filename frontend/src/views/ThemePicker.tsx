import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, VisuallyHidden } from '@primer/react'
import { dispatchThemePreview, getThemePreview, subscribeThemePreview } from '../shared/appearancePreview'
import type { ResolvedMode } from '../shared/appearance'
import type { ThemeOption } from './useThemeOptions'
import styles from './ThemePicker.module.css'

// An inline theme collection. Single theme supplies two titled family
// groups; Follow system supplies one family per row. Every option keeps
// explicit family metadata so preview and commit never infer it from
// a scheme id.

// SWATCH_TOKENS are the three that read a palette at a glance: the
// page behind everything, the text on it, and the accent that carries
// every link and selected state.
const SWATCH_TOKENS = ['--bgColor-default', '--fgColor-default', '--fgColor-accent'] as const

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

export interface ThemeGroup {
  family: ResolvedMode
  label: string
  options: ThemeOption[]
}

export interface ThemeSelection {
  family: ResolvedMode
  scheme: string
}

export function ThemePicker({ groups, value, labelId, testId, onCommit }: {
  groups: ThemeGroup[]
  value: ThemeSelection
  labelId: string
  testId: string
  onCommit: (selection: ThemeSelection) => void
}) {
  const { t } = useTranslation('views')
  const options = useMemo(() => groups.flatMap((group) => group.options), [groups])
  const schemeKey = options.map((option) => `${option.family}:${option.scheme}`).join(' ')
  const preview = useSyncExternalStore(subscribeThemePreview, getThemePreview, nullPreview)
  const [swatches, setSwatches] = useState<Record<string, string[]>>({})
  useEffect(() => {
    const next: Record<string, string[]> = {}
    for (const group of groups) {
      const familySwatches = readSwatches(group.family, group.options.map((option) => option.scheme))
      for (const [scheme, colors] of Object.entries(familySwatches)) next[optionKey(group.family, scheme)] = colors
    }
    setSwatches(next)
  }, [groups, schemeKey])

  useEffect(() => () => dispatchThemePreview({ kind: 'leave' }), [])

  // Escape is bound on the window rather than on the list: a pointer
  // preview never moves focus, so a handler on this subtree would
  // never see the key that is supposed to cancel it.
  useEffect(() => {
    if (preview === null || !options.some((option) => sameSelection(option, preview))) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      dispatchThemePreview({ kind: 'cancel' })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [options, preview])

  // The remaining preview handlers sit on the wrapper, not on the
  // list: leaving by pointer and tabbing out are one question -- is
  // the pointer or the focus still inside this control.
  return (
    <div
      className={styles.wrap}
      onPointerLeave={() => dispatchThemePreview({ kind: 'leave' })}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) dispatchThemePreview({ kind: 'leave' })
      }}
    >
      <span role="status" aria-label={t('settings.theme.previewLabel')} className={styles.announce}>
        {preview !== null ? labelFor(options, preview) : ''}
      </span>
      {/* role="listbox" is what turns the kit's list into a real radio
          group: its items become options with aria-selected, and the
          kit's own focus zone takes over the arrow keys, which is what
          makes arrowing preview. */}
      <ActionList role="listbox" selectionVariant="single" aria-labelledby={labelId} data-testid={testId} className={styles.list}>
      {groups.map((group) => groups.length > 1 ? (
        <ActionList.Group key={group.family}>
          <ActionList.GroupHeading>{group.label}</ActionList.GroupHeading>
          {renderOptions(group.options)}
        </ActionList.Group>
      ) : renderOptions(group.options))}
      </ActionList>
    </div>
  )

  function renderOptions(groupOptions: ThemeOption[]) {
    return groupOptions.map((option) => (
        <ActionList.Item
          key={`${option.family}:${option.scheme}`}
          selected={sameSelection(option, value)}
          data-testid={`${testId}-option-${option.scheme}`}
          onPointerMove={(event) => {
            if (event.pointerType === 'touch') return
            dispatchThemePreview({ kind: 'point', family: option.family, scheme: option.scheme })
          }}
          onFocus={() => dispatchThemePreview({ kind: 'point', family: option.family, scheme: option.scheme })}
          onSelect={() => {
            dispatchThemePreview({ kind: 'commit' })
            onCommit(option)
          }}
        >
          <ActionList.LeadingVisual>
            <span className={styles.swatch} aria-hidden="true">
              {(swatches[optionKey(option.family, option.scheme)] ?? ['', '', '']).map((color, i) => (
                <span key={SWATCH_TOKENS[i]} className={styles.chip} style={{ background: color }} />
              ))}
            </span>
          </ActionList.LeadingVisual>
          <VisuallyHidden>{t(`settings.theme.family.${option.family}`)} </VisuallyHidden>
          {option.label}
          {option.pluginName && (
            <ActionList.Description>{t('settings.theme.fromPlugin', { plugin: option.pluginName })}</ActionList.Description>
          )}
        </ActionList.Item>
      ))
  }
}

function nullPreview(): null {
  return null
}

// The previewed theme is announced rather than only painted: a
// keyboard user arrowing the list sees the window change but would
// otherwise never be told which theme they are on.
function labelFor(options: ThemeOption[], selection: ThemeSelection): string {
  return options.find((option) => sameSelection(option, selection))?.label ?? ''
}

function sameSelection(a: ThemeSelection, b: ThemeSelection): boolean {
  return a.family === b.family && a.scheme === b.scheme
}

function optionKey(family: ResolvedMode, scheme: string): string {
  return `${family}:${scheme}`
}
