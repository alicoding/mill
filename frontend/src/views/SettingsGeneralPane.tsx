import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Browser } from '@wailsio/runtime'
import { Button, Checkbox, SegmentedControl, Stack, Text } from '@primer/react'
import { SettingsService } from '../shared/bindings'
import { setSaveMode, useSaveMode } from '../shared/saveMode'
import { setCanvasNavigationMode, useCanvasNavigationMode } from '../shared/canvasNavigation'
import { SettingsRow } from './SettingsRow'
import listStyles from '../shared/ListCard.module.css'
import { background } from '../shared/background'

// Deep-links straight to the Login Items pane -- same undocumented-but-
// stable x-apple.systempreferences scheme ACCESSIBILITY_SETTINGS_URL
// already relies on, confirmed against multiple independent write-ups
// (Apple Stack Exchange's accepted answer for opening this exact pane,
// and Der Flounder's own command-line survey) since Apple doesn't
// publish a URL-scheme reference for System Settings panes.
const LOGIN_ITEMS_SETTINGS_URL = 'x-apple.systempreferences:com.apple.LoginItems-Settings.extension'

// Settings > General (goal 0321): launch at login, save mode, canvas
// navigation -- three real settings, each one two-column row. Save
// mode and canvas navigation used to be their own stacked controls
// (SaveModeControl / CanvasNavigationControl); they read and write the
// same shared stores, now rendered in the pane's own row shape.
export default function SettingsGeneralPane() {
  const { t } = useTranslation('views')
  const saveMode = useSaveMode()
  const canvasMode = useCanvasNavigationMode()

  // 'disabled' | 'enabled' | 'requires-approval' (launchatlogin.LoginItemStatus)
  // -- null only for the one render before the mount fetch resolves.
  const [launchAtLoginStatus, setLaunchAtLoginStatus] = useState<string | null>(null)
  const [launchAtLoginError, setLaunchAtLoginError] = useState('')

  useEffect(() => {
    SettingsService.GetLaunchAtLogin()
      .then(setLaunchAtLoginStatus)
      .catch((err) => setLaunchAtLoginError(String(err)))
  }, [])

  // Re-queries the real status after a successful write rather than
  // assuming `enabled` -- a first-time Enable can land directly on
  // 'requires-approval', which an optimistic true would misreport as
  // fully on.
  const toggleLaunchAtLogin = (enabled: boolean) => {
    setLaunchAtLoginError('')
    SettingsService.SetLaunchAtLogin(enabled)
      .then(() => SettingsService.GetLaunchAtLogin())
      .then(setLaunchAtLoginStatus)
      .catch((err) => setLaunchAtLoginError(String(err)))
  }

  return (
    <>
      <SettingsRow
        label={t('settings.general.launchAtLoginLabel')}
        caption={t('settings.general.launchAtLoginCaption')}
        // Disabled whenever the real OS registration state is
        // unreadable (server mode, a bare dev binary): a switch that
        // cannot reflect the state it controls would show a confident
        // "off" for something Mill has not actually read. The line
        // below it says which case this is.
        control={(labelId) => (
          <Checkbox
            aria-labelledby={labelId}
            checked={launchAtLoginStatus === 'enabled' || launchAtLoginStatus === 'requires-approval'}
            disabled={launchAtLoginStatus === null}
            onChange={(e) => toggleLaunchAtLogin(e.target.checked)}
            data-testid="launch-at-login-checkbox"
          />
        )}
      />
      {launchAtLoginStatus === 'requires-approval' && (
        <Stack direction="horizontal" gap="condensed" align="center" data-testid="launch-at-login-requires-approval">
          <Text as="p" size="small" className={listStyles.attention}>
            {t('settings.general.launchAtLoginRequiresApproval')}
          </Text>
          <Button size="small" onClick={() => Browser.OpenURL(LOGIN_ITEMS_SETTINGS_URL)}>
            {t('settings.general.openLoginItemsSettings')}
          </Button>
        </Stack>
      )}
      {launchAtLoginError && (
        <Text as="p" size="small" className={listStyles.error}>
          {launchAtLoginError.includes('dev binary')
            ? t('settings.general.errorDevBinary')
            : launchAtLoginError.includes('server mode')
              ? t('settings.general.errorServerMode')
              : launchAtLoginError}
        </Text>
      )}

      <SettingsRow
        label={t('settings.general.saveModeLabel')}
        caption={saveMode === 'explicit'
          ? t('settings.general.saveModeExplicitCaption')
          : t('settings.general.saveModeAutomaticCaption')}
        captionTestId="save-mode-caption"
        control={() => (
          <SegmentedControl
            aria-label={t('settings.general.saveModeLabel')}
            onChange={(i) => { void background(setSaveMode(i === 1 ? 'explicit' : 'automatic'), 'settingsGeneralPane.setSaveMode') }}
            data-testid="save-mode-control"
          >
            <SegmentedControl.Button selected={saveMode === 'automatic'}>
              {t('settings.general.saveModeAutomatic')}
            </SegmentedControl.Button>
            <SegmentedControl.Button selected={saveMode === 'explicit'}>
              {t('settings.general.saveModeExplicit')}
            </SegmentedControl.Button>
          </SegmentedControl>
        )}
      />

      <SettingsRow
        label={t('settings.general.canvasNavigationLabel')}
        caption={canvasMode === 'mouse'
          ? t('settings.general.canvasNavigationMouseCaption')
          : t('settings.general.canvasNavigationTrackpadCaption')}
        captionTestId="canvas-navigation-caption"
        control={() => (
          <SegmentedControl
            aria-label={t('settings.general.canvasNavigationLabel')}
            onChange={(i) => setCanvasNavigationMode(i === 1 ? 'mouse' : 'trackpad')}
            data-testid="canvas-navigation-control"
          >
            <SegmentedControl.Button selected={canvasMode === 'trackpad'}>
              {t('settings.general.canvasNavigationTrackpad')}
            </SegmentedControl.Button>
            <SegmentedControl.Button selected={canvasMode === 'mouse'}>
              {t('settings.general.canvasNavigationMouse')}
            </SegmentedControl.Button>
          </SegmentedControl>
        )}
      />
    </>
  )
}
