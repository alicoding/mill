import { useEffect, useState } from 'react'
import { Browser } from '@wailsio/runtime'
import { Button, Checkbox, FormControl, Heading, Label, SegmentedControl, Stack, Text, useTheme } from '@primer/react'
import { SunIcon, MoonIcon, DeviceDesktopIcon, KeyIcon } from '@primer/octicons-react'
import * as SettingsService from '../../bindings/github.com/alicoding/mill/settingsservice'
import { keyFromEventCode, modsFromEvent } from '../shared/keybinding'
import { isAccessibilityError, ACCESSIBILITY_SETTINGS_URL } from '../composition/hotkeyCapture'
import styles from '../shared/ListCard.module.css'

const COLOR_MODES = ['light', 'dark', 'auto'] as const

// A dedicated Settings page, reached via the sidebar's own bottom-
// anchored footer icon (App.tsx) rather than a NavList entry alongside
// the capability rows -- Notion/Slack's own pattern for app-level
// config vs. content destinations, matching docs/SPEC.md §3.5's
// "Sidebar restructuring" bullet. Moved here from App.tsx's bottom bar,
// which the theme control previously shared with the version/clock/docs
// link -- giving Settings a real page instead of a cramped footer
// control also leaves room to grow (more app-level preferences land
// here, not back in the footer). Persisting the choice and mirroring it
// onto <html> stays in App.tsx (global app-shell behavior that must run
// regardless of whether this page is even mounted), not duplicated here
// -- this component only renders the control, via Primer's own shared
// useTheme() context (same ThemeProvider ancestor App.tsx reads from).
//
// "Launch at login" and "Global hotkey" (docs/SPEC.md §3.7's research,
// now implemented) are the first two genuinely global, non-workflow,
// non-Configure settings -- distinct from Appearance above, which is a
// frontend-only localStorage preference; these two round-trip through
// SettingsService (settingsservice.go) since they're real OS-level
// state (a login item, a global hotkey registration), not something the
// browser layer can hold on its own.
function SettingsView() {
  const { colorMode, setColorMode } = useTheme()

  const [launchAtLogin, setLaunchAtLoginState] = useState<boolean | null>(null)
  const [launchAtLoginError, setLaunchAtLoginError] = useState('')

  const [summonBinding, setSummonBinding] = useState<string | null>(null)
  const [summonRecording, setSummonRecording] = useState(false)
  const [summonError, setSummonError] = useState('')

  const [updateStatus, setUpdateStatus] = useState('')
  const [updateChecking, setUpdateChecking] = useState(false)

  useEffect(() => {
    SettingsService.GetLaunchAtLogin()
      .then(setLaunchAtLoginState)
      .catch((err) => setLaunchAtLoginError(String(err)))
    SettingsService.GetSummonHotkey()
      .then((label) => setSummonBinding(label || null))
      .catch(console.error)
  }, [])

  useEffect(() => {
    if (!summonRecording) return

    const onKeydown = (e: KeyboardEvent) => {
      e.preventDefault()
      if (e.key === 'Escape') {
        setSummonRecording(false)
        return
      }
      const key = keyFromEventCode(e.code)
      if (!key) return // modifier-only press, or an unsupported key -- keep waiting
      const mods = modsFromEvent(e)
      if (mods.length === 0) return // require at least one modifier

      setSummonRecording(false)
      setSummonError('')
      SettingsService.AssignSummonHotkey(mods, key)
        .then(setSummonBinding)
        .catch((err) => setSummonError(String(err)))
    }

    window.addEventListener('keydown', onKeydown, true)
    return () => window.removeEventListener('keydown', onKeydown, true)
  }, [summonRecording])

  const toggleLaunchAtLogin = (enabled: boolean) => {
    setLaunchAtLoginError('')
    SettingsService.SetLaunchAtLogin(enabled)
      .then(() => setLaunchAtLoginState(enabled))
      .catch((err) => setLaunchAtLoginError(String(err)))
  }

  const clearSummonHotkey = () => {
    setSummonError('')
    SettingsService.UnassignSummonHotkey().then(() => setSummonBinding(null)).catch(console.error)
  }

  const checkForUpdates = () => {
    setUpdateChecking(true)
    setUpdateStatus('')
    SettingsService.CheckForUpdates()
      .then((result) => {
        setUpdateStatus(result.updateAvailable ? `Update available: v${result.version}` : "You're on the latest version.")
      })
      .catch((err) => setUpdateStatus(String(err)))
      .finally(() => setUpdateChecking(false))
  }

  return (
    <div className={styles.formPage} data-testid="settings-view">
      <Heading as="h1">Settings</Heading>
      <Text as="p" className={styles.subtitle}>
        App-level preferences -- not workflow or Configure-authored data (that lives in Composition/Configure), a
        UI preference persisted locally to this machine.
      </Text>

      <Heading as="h2" variant="small" className={styles.sectionHeading}>Appearance</Heading>
      <SegmentedControl aria-label="Color theme" onChange={(i) => setColorMode(COLOR_MODES[i])}>
        <SegmentedControl.IconButton icon={SunIcon} aria-label="Light theme" selected={colorMode === 'light'} />
        <SegmentedControl.IconButton icon={MoonIcon} aria-label="Dark theme" selected={colorMode === 'dark'} />
        <SegmentedControl.IconButton icon={DeviceDesktopIcon} aria-label="Match system theme" selected={!colorMode || colorMode === 'auto'} />
      </SegmentedControl>

      <Heading as="h2" variant="small" className={styles.sectionHeading}>General</Heading>
      <FormControl>
        <Checkbox
          checked={launchAtLogin ?? false}
          disabled={launchAtLogin === null}
          onChange={(e) => toggleLaunchAtLogin(e.target.checked)}
          data-testid="launch-at-login-checkbox"
        />
        <FormControl.Label>Launch Mill at login</FormControl.Label>
        <FormControl.Caption>Starts Mill automatically when you log in, same as Raycast/Alfred (docs/SPEC.md §3.7).</FormControl.Caption>
      </FormControl>
      {launchAtLoginError && (
        <Text as="p" size="small" className={styles.error}>
          {launchAtLoginError.includes('dev binary')
            ? 'Not available in this dev build -- only a built .app bundle can be a login item.'
            : launchAtLoginError.includes('server mode')
              ? 'Not available in server mode -- there is no login-item concept without a desktop app to register.'
              : launchAtLoginError}
        </Text>
      )}

      <Heading as="h2" variant="small" className={styles.sectionHeading}>Global hotkey</Heading>
      <Text as="p" size="small" className={styles.muted}>
        Summons Mill's window from anywhere, like Raycast's ⌥Space or Alfred's own shortcut -- distinct from a
        specific workflow's own trigger hotkey (set per-workflow on its canvas).
      </Text>
      <Stack direction="horizontal" gap="condensed" align="center" style={{ marginTop: 'var(--base-size-8)' }}>
        {summonRecording ? (
          <Text size="small" className={styles.recording}>Press a combo… (Esc to cancel)</Text>
        ) : summonBinding ? (
          <>
            <Label variant="secondary"><KeyIcon size={12} /> {summonBinding}</Label>
            <Button size="small" variant="invisible" onClick={() => setSummonRecording(true)}>Change</Button>
            <Button size="small" variant="invisible" onClick={clearSummonHotkey}>Clear</Button>
          </>
        ) : (
          <Button size="small" variant="invisible" onClick={() => setSummonRecording(true)} data-testid="set-summon-hotkey">
            Set shortcut
          </Button>
        )}
      </Stack>
      {summonError && (
        <Stack direction="vertical" gap="condensed" style={{ marginTop: 'var(--base-size-8)' }}>
          <Text as="p" size="small" className={styles.error}>{summonError}</Text>
          {isAccessibilityError(summonError) && (
            <Button size="small" onClick={() => Browser.OpenURL(ACCESSIBILITY_SETTINGS_URL)}>
              Open Accessibility Settings
            </Button>
          )}
        </Stack>
      )}

      <Heading as="h2" variant="small" className={styles.sectionHeading}>Updates</Heading>
      <Stack direction="horizontal" gap="condensed" align="center">
        <Button size="small" onClick={checkForUpdates} disabled={updateChecking} data-testid="check-for-updates">
          {updateChecking ? 'Checking…' : 'Check for updates'}
        </Button>
        {updateStatus && <Text size="small" className={styles.muted}>{updateStatus}</Text>}
      </Stack>
    </div>
  )
}

export default SettingsView
