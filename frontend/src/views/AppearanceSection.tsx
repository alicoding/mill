import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SegmentedControl, Select } from '@primer/react'
import { SunIcon, MoonIcon, DeviceDesktopIcon } from '@primer/octicons-react'
import { SettingsService } from '../shared/bindings'
import { applyDensity, type DisplayDensity } from '../shared/density'
import { SettingsRow } from './SettingsRow'
import { background } from '../shared/background'
import {
  DARK_SCHEMES,
  LIGHT_SCHEMES,
  getAppearance,
  setAppearance,
  subscribeAppearance,
  type ColorMode,
  type DarkScheme,
  type LightScheme,
} from '../shared/appearance'

// Settings > Appearance (goal 0320, re-shaped by goal 0321): color
// theme, then the scheme used in each appearance, then density -- four
// two-column rows. The two scheme rows carry DISTINCT names ("Light
// appearance" / "Dark appearance"): they used to share one label,
// which read as the same setting listed twice.
//
// Every control writes through the door that reaches EVERY open window
// -- setAppearance for the theme, SetDisplayDensity plus the same
// broadcast for density -- so a change made here lands in the Quick
// Panel, the tray panel and the run monitor without a reload.

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

  const schemeOptions = (schemes: readonly string[]) =>
    schemes.map((id) => (
      <Select.Option key={id} value={id}>{t(`settings.appearance.schemes.${SCHEME_LABEL_KEY[id]}`)}</Select.Option>
    ))

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
      <SettingsRow
        label={t('settings.appearance.lightAppearanceLabel')}
        caption={t('settings.appearance.lightSchemeCaption')}
        control={(labelId) => (
          <Select
            aria-labelledby={labelId}
            value={appearance.lightScheme}
            onChange={(e) => setAppearance({ ...appearance, lightScheme: e.target.value as LightScheme })}
            data-testid="light-scheme-select"
          >
            {schemeOptions(LIGHT_SCHEMES)}
          </Select>
        )}
      />
      <SettingsRow
        label={t('settings.appearance.darkAppearanceLabel')}
        caption={t('settings.appearance.darkSchemeCaption')}
        control={(labelId) => (
          <Select
            aria-labelledby={labelId}
            value={appearance.darkScheme}
            onChange={(e) => setAppearance({ ...appearance, darkScheme: e.target.value as DarkScheme })}
            data-testid="dark-scheme-select"
          >
            {schemeOptions(DARK_SCHEMES)}
          </Select>
        )}
      />
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
