import { useEffect, useState } from 'react'
import { Browser } from '@wailsio/runtime'
import { Button, Checkbox, FormControl, Heading, Label, SegmentedControl, Stack, Text, TextInput, useTheme } from '@primer/react'
import { SunIcon, MoonIcon, DeviceDesktopIcon, KeyIcon } from '@primer/octicons-react'
import { SettingsService } from '../shared/bindings'
import { describeCombo, keyFromEventCode, modsFromEvent, reservedByMacOS } from '../shared/keybinding'
import { isAccessibilityError, ACCESSIBILITY_SETTINGS_URL } from '../composition/hotkeyCapture'
import KeyboardShortcutsSection from './KeyboardShortcutsSection'
import styles from '../shared/ListCard.module.css'
import PageContainer from '../shared/PageContainer'

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

  const [mcpWriteEnabled, setMCPWriteEnabledState] = useState<boolean | null>(null)
  const [mcpApprovalRequired, setMCPApprovalRequiredState] = useState<boolean | null>(null)

  // Attention/notifications (docs/goals/0023-attention-escalation.md item
  // 2): the idle-aware presence-gate threshold. The cross-device forward's
  // own toggle moved to composition (docs/adr/0035) -- see the seeded
  // "Example: Forward pending approvals" workflow instead.
  const [idleThreshold, setIdleThresholdState] = useState<number | null>(null)

  // docs/adr/0035's audit finding: these mount fetches used to fail
  // silently (console.error only), leaving their controls disabled
  // forever with no visible explanation -- the "untogglable checkbox"/
  // "empty stepper" bugs reported live were a stale binary, but a real
  // fetch failure (a genuinely broken RPC) would have looked identical.
  // One shared banner rather than a per-field message: these three all
  // fail for the same reason (the backend didn't answer), and a build
  // this small doesn't need per-control diagnosis.
  const [settingsLoadError, setSettingsLoadError] = useState(false)

  useEffect(() => {
    SettingsService.GetLaunchAtLogin()
      .then(setLaunchAtLoginState)
      .catch((err) => setLaunchAtLoginError(String(err)))
    SettingsService.GetSummonHotkey()
      .then((label) => setSummonBinding(label || null))
      .catch((err) => { console.error(err); setSettingsLoadError(true) })
    SettingsService.GetMCPWriteEnabled()
      .then(setMCPWriteEnabledState)
      .catch((err) => { console.error(err); setSettingsLoadError(true) })
    SettingsService.GetMCPWriteApprovalRequired()
      .then(setMCPApprovalRequiredState)
      .catch((err) => { console.error(err); setSettingsLoadError(true) })
    SettingsService.GetAttentionIdleThreshold()
      .then(setIdleThresholdState)
      .catch((err) => { console.error(err); setSettingsLoadError(true) })
  }, [])

  // Same menu-accelerator-suspension bracket as
  // composition/hotkeyCapture.ts's useHotkeyCapture -- see its own
  // comment for the full reasoning (a real, owner-hit bug: an
  // app-menu-reserved combo pressed while a recorder was armed closed
  // the window, since NSMenu's performKeyEquivalent: intercepts the
  // keypress before this listener ever sees it). This is the third,
  // independent recording surface (the other two share the hook);
  // duplicated here rather than generalizing SettingsView onto
  // useHotkeyCapture itself, since the summon hotkey isn't
  // workflow-scoped (useHotkeyCapture is keyed by workflowId) and
  // round-trips through SettingsService.AssignSummonHotkey, not
  // TriggerService.AssignHotkey -- a real, different RPC, not just a
  // different id.
  useEffect(() => {
    if (!summonRecording) return

    SettingsService.SuspendMenuAccelerators().catch(console.error)

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

      const reserved = reservedByMacOS(mods, key)
      if (reserved) {
        setSummonRecording(false)
        setSummonError(`${describeCombo(mods, key)} is reserved by macOS (${reserved}) — pick another combo`)
        return
      }

      setSummonRecording(false)
      setSummonError('')
      SettingsService.AssignSummonHotkey(mods, key)
        .then(setSummonBinding)
        .catch((err) => setSummonError(String(err)))
    }
    const onBlur = () => setSummonRecording(false)

    window.addEventListener('keydown', onKeydown, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeydown, true)
      window.removeEventListener('blur', onBlur)
      SettingsService.RestoreMenuAccelerators().catch(console.error)
    }
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

  // docs/goals/0023-attention-escalation.md item 2: committed on blur
  // (a numeric field on every keystroke would spam SetAttentionIdleThreshold
  // with half-typed values) -- a non-positive/empty value resets to the
  // backend's own default, mirrored client-side by simply refetching.
  const commitIdleThreshold = (raw: string) => {
    const n = parseInt(raw, 10)
    SettingsService.SetAttentionIdleThreshold(Number.isFinite(n) ? n : 0)
      .then(() => SettingsService.GetAttentionIdleThreshold())
      .then(setIdleThresholdState)
      .catch(console.error)
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
    <PageContainer variant="narrow" data-testid="settings-view">
      <Heading as="h1">Settings</Heading>
      <Text as="p" className={styles.subtitle}>
        App-level preferences -- not workflow or Configure-authored data (that lives in Composition/Configure), a
        UI preference persisted locally to this machine.
      </Text>
      {settingsLoadError && (
        <Text as="p" size="small" className={styles.error} data-testid="settings-load-error">
          Couldn&apos;t load some settings -- the app may need a restart.
        </Text>
      )}

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

      <Heading as="h2" variant="small" className={styles.sectionHeading}>Keyboard Shortcuts</Heading>
      <Text as="p" size="small" className={styles.muted}>
        Every in-window command Mill dispatches (docs/goals/0016-keymap-system.md) -- rebind by clicking a combo
        and pressing a new one, the same recorder used for a workflow's own trigger hotkey below.
      </Text>
      <KeyboardShortcutsSection />

      <Heading as="h2" variant="small" className={styles.sectionHeading}>Global hotkey</Heading>
      <Text as="p" size="small" className={styles.muted}>
        Opens Mill's Quick Panel from anywhere, like Raycast's ⌥Space or Alfred's own shortcut -- search and run a
        workflow, or jump into Mill itself, without leaving what you were doing. Press again to dismiss it.
        Distinct from a specific workflow's own trigger hotkey (set per-workflow on its canvas).
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

      <Heading as="h2" variant="small" className={styles.sectionHeading}>MCP access</Heading>
      <FormControl>
        <Checkbox
          checked={mcpWriteEnabled ?? false}
          disabled={mcpWriteEnabled === null}
          onChange={(e) => {
            const enabled = e.target.checked
            SettingsService.SetMCPWriteEnabled(enabled).then(() => setMCPWriteEnabledState(enabled)).catch(console.error)
          }}
          data-testid="mcp-write-enabled-checkbox"
        />
        <FormControl.Label>Allow MCP clients to import data</FormControl.Label>
        <FormControl.Caption>
          Off by default (docs/adr/0017): when on, an external MCP client connected to Mill&apos;s local MCP
          server can create workflows, integrations, lists, and MCP-server entries via the import tools --
          reading/exporting is always allowed and never includes secrets. Applies immediately, no restart.
        </FormControl.Caption>
      </FormControl>
      {mcpWriteEnabled && (
        <FormControl>
          <Checkbox
            checked={mcpApprovalRequired ?? true}
            disabled={mcpApprovalRequired === null}
            onChange={(e) => {
              const required = e.target.checked
              SettingsService.SetMCPWriteApprovalRequired(required).then(() => setMCPApprovalRequiredState(required)).catch(console.error)
            }}
            data-testid="mcp-write-approval-checkbox"
          />
          <FormControl.Label>Ask me before each MCP import</FormControl.Label>
          <FormControl.Caption>
            On by default (docs/adr/0022): each import parks until you approve it in Mill&apos;s window
            (or times out after 2 minutes, which denies it). Turning this off lets an enabled MCP client
            import without a per-write click -- enabling writes shouldn&apos;t silently mean unattended writes.
          </FormControl.Caption>
        </FormControl>
      )}

      <Heading as="h2" variant="small" className={styles.sectionHeading}>Notifications</Heading>
      <Text as="p" size="small" className={styles.muted}>
        A parked guardrail ask or MCP write notifies you and shows a floating approval prompt (docs/adr/0032,
        docs/goals/0023) once you&apos;re away -- not merely unfocused, but idle past the threshold below, or
        genuinely unfocused. A present, actively-using-Mill window is never double-noised.
      </Text>
      <FormControl>
        <FormControl.Label>Away after (seconds)</FormControl.Label>
        <TextInput
          type="number"
          min={1}
          defaultValue={idleThreshold ?? undefined}
          key={idleThreshold ?? 'loading'}
          onBlur={(e) => commitIdleThreshold(e.target.value)}
          disabled={idleThreshold === null}
          data-testid="attention-idle-threshold-input"
          size="small"
        />
        <FormControl.Caption>
          How long the Mac must sit idle (no keyboard/mouse/trackpad input) while Mill is focused before
          you&apos;re treated as away -- 300s (5 minutes) by default, matching Teams&apos; own away-status
          default. Losing focus entirely always counts as away regardless of this number.
        </FormControl.Caption>
      </FormControl>
      <Text as="p" size="small" className={styles.muted}>
        For the notification to alert instead of only appearing quietly in Notification Center, allow it in
        System Settings → Notifications → Mill → Alerts (docs/goals/0023 item 3) -- Mill requests notification
        permission on first launch, but macOS still defaults new apps to Banners, which auto-dismiss.
      </Text>

      <Heading as="h2" variant="small" className={styles.sectionHeading}>Updates</Heading>
      <Stack direction="horizontal" gap="condensed" align="center">
        <Button size="small" onClick={checkForUpdates} disabled={updateChecking} data-testid="check-for-updates">
          {updateChecking ? 'Checking…' : 'Check for updates'}
        </Button>
        {updateStatus && <Text size="small" className={styles.muted}>{updateStatus}</Text>}
      </Stack>
    </PageContainer>
  )
}

export default SettingsView
