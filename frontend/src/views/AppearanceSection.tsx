import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { Flash, SegmentedControl, Select } from '@primer/react'
import { SettingsService } from '../shared/bindings'
import { applyDensity, type DisplayDensity } from '../shared/density'
import { SettingsRow } from './SettingsRow'
import { mustSetting } from '../shared/settingsRegistry'
import { ThemePicker, type ThemeGroup, type ThemeSelection } from './ThemePicker'
import { useThemeOptions } from './useThemeOptions'
import { background } from '../shared/background'
import { pluginThemeRejections, subscribePluginThemes, type PluginThemeRejection } from '../shared/appearanceThemes'
import { dispatchThemePreview } from '../shared/appearancePreview'
import {
  DARK_SCHEMES,
  LIGHT_SCHEMES,
  getAppearance,
  setAppearance,
  subscribeAppearance,
  type ResolvedMode,
} from '../shared/appearance'

// Settings > Appearance: Single theme presents both families as one
// collection, while Follow system keeps a saved preference for each
// family. The persisted light/dark/auto mode remains the rendering
// contract; this view translates it to the two user-facing modes.
//
// Every commit writes through the door that reaches every open window
// -- setAppearance for the theme, SetDisplayDensity plus the same
// broadcast for density -- so a change made here lands in the Quick
// Panel, the tray panel and the run monitor without a reload. A
// preview deliberately does not: it never leaves this window.

const DENSITIES = ['comfortable', 'compact'] as const

// Primer's scheme ids, paired with the copy key each is listed under.
const SCHEME_LABEL_KEY: Record<string, string> = {
  light: 'default',
  dark: 'default',
  dark_dimmed: 'dimmed',
  light_high_contrast: 'highContrast',
  dark_high_contrast: 'highContrast',
  light_colorblind: 'colorblind',
  dark_colorblind: 'colorblind',
  light_colorblind_high_contrast: 'colorblindHighContrast',
  dark_colorblind_high_contrast: 'colorblindHighContrast',
  light_tritanopia: 'tritanopia',
  dark_tritanopia: 'tritanopia',
  light_tritanopia_high_contrast: 'tritanopiaHighContrast',
  dark_tritanopia_high_contrast: 'tritanopiaHighContrast',
}

export default function AppearanceSection() {
  const { t } = useTranslation('views')
  const [appearance, setLocal] = useState(getAppearance)
  useEffect(() => subscribeAppearance(() => setLocal(getAppearance())), [])

  // null only for the one render before the mount fetch resolves --
  // the SegmentedControl has no real "unset" rendering.
  const [density, setDensityState] = useState<DisplayDensity | null>(null)
  useEffect(() => {
    void background(SettingsService.GetDisplayDensity()
      .then((d) => setDensityState(d === 'compact' ? 'compact' : 'comfortable')), 'appearance.getDisplayDensity')
  }, [])

  // Density applies instantly, ahead of the persist RPC resolving, and
  // is never reverted on a failed write: the preference has no
  // OS-level consequence a briefly-wrong control could hide.
  const setDensity = (value: DisplayDensity) => {
    applyDensity(value)
    setDensityState(value)
    setAppearance(appearance, value)
    void background(SettingsService.SetDisplayDensity(value), 'appearance.setDisplayDensity')
  }

  const labelOf = useCallback((id: string) => t(`settings.appearance.schemes.${SCHEME_LABEL_KEY[id]}`), [t])
  const lightOptions = useThemeOptions('light', LIGHT_SCHEMES, labelOf)
  const darkOptions = useThemeOptions('dark', DARK_SCHEMES, labelOf)
  const rejections = useSyncExternalStore(subscribePluginThemes, pluginThemeRejections, noRejections)

  const lightGroup = useMemo<ThemeGroup>(() => ({
    family: 'light',
    label: t('settings.theme.lightGroup'),
    options: lightOptions,
  }), [lightOptions, t])
  const darkGroup = useMemo<ThemeGroup>(() => ({
    family: 'dark',
    label: t('settings.theme.darkGroup'),
    options: darkOptions,
  }), [darkOptions, t])
  const singleGroups = useMemo(() => [lightGroup, darkGroup], [lightGroup, darkGroup])

  const commitSingle = (selection: ThemeSelection) => {
    const current = getAppearance()
    setAppearance({
      ...current,
      mode: selection.family,
      ...(selection.family === 'light' ? { lightScheme: selection.scheme } : { darkScheme: selection.scheme }),
    })
  }
  const commitSystemPreference = (selection: ThemeSelection) => {
    const current = getAppearance()
    setAppearance({
      ...current,
      mode: 'auto',
      ...(selection.family === 'light' ? { lightScheme: selection.scheme } : { darkScheme: selection.scheme }),
    })
  }
  const setThemeMode = (value: 'single' | 'auto') => {
    dispatchThemePreview({ kind: 'cancel' })
    const current = getAppearance()
    if (value === 'auto') {
      setAppearance({ ...current, mode: 'auto' })
      return
    }
    const family: ResolvedMode = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    setAppearance({ ...current, mode: family })
  }

  const lightPicker = (labelId: string) => (
    <ThemePicker
      groups={[lightGroup]}
      value={{ family: 'light', scheme: appearance.lightScheme }}
      labelId={labelId}
      testId="light-scheme-select"
      onCommit={commitSystemPreference}
    />
  )
  const darkPicker = (labelId: string) => (
    <ThemePicker
      groups={[darkGroup]}
      value={{ family: 'dark', scheme: appearance.darkScheme }}
      labelId={labelId}
      testId="dark-scheme-select"
      onCommit={commitSystemPreference}
    />
  )
  const singlePicker = (labelId: string) => (
    <ThemePicker
      groups={singleGroups}
      value={appearance.mode === 'dark'
        ? { family: 'dark', scheme: appearance.darkScheme }
        : { family: 'light', scheme: appearance.lightScheme }}
      labelId={labelId}
      testId="single-theme-select"
      onCommit={commitSingle}
    />
  )

  return (
    <>
      <SettingsRow
        setting={mustSetting('appearance.colorMode')}
        control={(labelId) => (
          <Select
            aria-labelledby={labelId}
            value={appearance.mode === 'auto' ? 'auto' : 'single'}
            onChange={(event) => setThemeMode(event.target.value as 'single' | 'auto')}
            data-testid="theme-mode-select"
          >
            <Select.Option value="single">{t('settings.appearance.singleOption')}</Select.Option>
            <Select.Option value="auto">{t('settings.appearance.systemOption')}</Select.Option>
          </Select>
        )}
      />
      {appearance.mode !== 'auto' && <SettingsRow setting={mustSetting('appearance.theme')} control={singlePicker} />}
      {appearance.mode === 'auto' && (
        <>
          <SettingsRow setting={mustSetting('appearance.lightTheme')} control={lightPicker} />
          <SettingsRow setting={mustSetting('appearance.darkTheme')} control={darkPicker} />
        </>
      )}
      {rejections.map((r) => (
        <Flash key={r.schemeId} variant="warning" data-testid="theme-rejected">
          {t('settings.theme.rejected', { line: r.line })}
        </Flash>
      ))}
      <SettingsRow
        setting={mustSetting('appearance.density')}
        ready={density !== null}
        control={() => (
          <SegmentedControl
            aria-label={t('settings.appearance.densityLabel')}
            onChange={(i) => setDensity(DENSITIES[i])}
            data-testid="density-control"
          >
            <SegmentedControl.Button selected={(density ?? 'comfortable') === 'comfortable'}>
              {t('settings.appearance.comfortableOption')}
            </SegmentedControl.Button>
            <SegmentedControl.Button selected={density === 'compact'}>
              {t('settings.appearance.compactOption')}
            </SegmentedControl.Button>
          </SegmentedControl>
        )}
      />
    </>
  )
}

const NONE: PluginThemeRejection[] = []
function noRejections(): PluginThemeRejection[] {
  return NONE
}
