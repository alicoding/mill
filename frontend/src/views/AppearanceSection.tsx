import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { Flash, SegmentedControl } from '@primer/react'
import { SunIcon, MoonIcon, DeviceDesktopIcon } from '@primer/octicons-react'
import { SettingsService } from '../shared/bindings'
import { applyDensity, type DisplayDensity } from '../shared/density'
import { SettingsRow } from './SettingsRow'
import { ThemePicker, useThemeOptions } from './ThemePicker'
import { background } from '../shared/background'
import { pluginThemeRejections, subscribePluginThemes, type PluginThemeRejection } from '../shared/appearanceThemes'
import {
  DARK_SCHEMES,
  LIGHT_SCHEMES,
  getAppearance,
  setAppearance,
  subscribeAppearance,
  type ColorMode,
} from '../shared/appearance'

// Settings > Appearance (goal 0320, re-shaped by 0321 and 0342): the
// color mode, the theme used in whichever appearance the mode names,
// then density.
//
// The pickers FOLLOW THE MODE. Under a fixed Light or Dark there is
// one list, of that family's themes; under Match system there are two,
// one per family, each captioned with when it applies. Showing both
// lists under a fixed mode is what made a change look like it did
// nothing: half the control on screen could not affect the window in
// front of you.
//
// Every commit writes through the door that reaches EVERY open window
// -- setAppearance for the theme, SetDisplayDensity plus the same
// broadcast for density -- so a change made here lands in the Quick
// Panel, the tray panel and the run monitor without a reload. A
// PREVIEW deliberately does not: it never leaves this window.

const COLOR_MODES = ['light', 'dark', 'auto'] as const
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

  const setMode = (mode: ColorMode) => setAppearance({ ...appearance, mode })
  const labelOf = useCallback((id: string) => t(`settings.appearance.schemes.${SCHEME_LABEL_KEY[id]}`), [t])
  const lightOptions = useThemeOptions('light', LIGHT_SCHEMES, labelOf)
  const darkOptions = useThemeOptions('dark', DARK_SCHEMES, labelOf)
  const rejections = useSyncExternalStore(subscribePluginThemes, pluginThemeRejections, noRejections)

  const lightPicker = (labelId: string) => (
    <ThemePicker
      family="light"
      options={lightOptions}
      value={appearance.lightScheme}
      labelId={labelId}
      testId="light-scheme-select"
      onCommit={(scheme) => setAppearance({ ...appearance, lightScheme: scheme })}
    />
  )
  const darkPicker = (labelId: string) => (
    <ThemePicker
      family="dark"
      options={darkOptions}
      value={appearance.darkScheme}
      labelId={labelId}
      testId="dark-scheme-select"
      onCommit={(scheme) => setAppearance({ ...appearance, darkScheme: scheme })}
    />
  )

  return (
    <>
      <SettingsRow
        label={t('settings.appearance.themeLabel')}
        control={() => (
          <SegmentedControl aria-label={t('settings.appearance.themeLabel')} onChange={(i) => setMode(COLOR_MODES[i])}>
            <SegmentedControl.IconButton icon={SunIcon} aria-label={t('settings.appearance.lightLabel')} selected={appearance.mode === 'light'} />
            <SegmentedControl.IconButton icon={MoonIcon} aria-label={t('settings.appearance.darkLabel')} selected={appearance.mode === 'dark'} />
            <SegmentedControl.IconButton icon={DeviceDesktopIcon} aria-label={t('settings.appearance.systemLabel')} selected={appearance.mode === 'auto'} />
          </SegmentedControl>
        )}
      />
      {appearance.mode === 'light' && <SettingsRow label={t('settings.theme.label')} control={lightPicker} />}
      {appearance.mode === 'dark' && <SettingsRow label={t('settings.theme.label')} control={darkPicker} />}
      {appearance.mode === 'auto' && (
        <>
          <SettingsRow label={t('settings.theme.lightLabel')} caption={t('settings.theme.lightCaption')} control={lightPicker} />
          <SettingsRow label={t('settings.theme.darkLabel')} caption={t('settings.theme.darkCaption')} control={darkPicker} />
        </>
      )}
      {rejections.map((r) => (
        <Flash key={r.schemeId} variant="warning" data-testid="theme-rejected">
          {t('settings.theme.rejected', { line: r.line })}
        </Flash>
      ))}
      <SettingsRow
        label={t('settings.appearance.densityLabel')}
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
