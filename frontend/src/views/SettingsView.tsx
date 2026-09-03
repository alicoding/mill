import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Browser } from '@wailsio/runtime'
import { Button, Checkbox, FormControl, Heading, SegmentedControl, Stack, Text, TextInput, useTheme } from '@primer/react'
import { SunIcon, MoonIcon, DeviceDesktopIcon, KeyIcon, SearchIcon } from '@primer/octicons-react'
import { KeyComboChip } from '../shared/KeyComboChip'
import { SettingsService } from '../shared/bindings'
import { describeCombo, keyFromEventCode, modsFromEvent, reservedByMacOS } from '../shared/keybinding'
import { isAccessibilityError, ACCESSIBILITY_SETTINGS_URL } from '../composition/hotkeyCapture'
import { useIsNarrowViewport } from '../shared/useNarrowViewport'
import { usePrefersReducedMotion } from '../shared/usePrefersReducedMotion'
import { SETTINGS_SECTIONS, sectionMatchesQuery } from '../shared/settingsSections'
import { applyDensity } from '../shared/density'
import { CanvasNavigationControl } from './CanvasNavigationControl'
import { SaveModeControl } from './SaveModeControl'
import type { DisplayDensity } from '../shared/density'
import KeyboardShortcutsSection from './KeyboardShortcutsSection'
import ExtensionsSection from './ExtensionsSection'
import ContractSection from './ContractSection'
import DataStewardshipSection from './DataStewardshipSection'
import UpdatesSection from './UpdatesSection'
import McpAddressField from './McpAddressField'
import RemoteAccessSection from './RemoteAccessSection'
import SettingsToc from './SettingsToc'
import { useSettingsSectionSync } from './useSettingsSectionSync'
import styles from '../shared/ListCard.module.css'
import settingsStyles from './SettingsView.module.css'
import PageContainer from '../shared/PageContainer'

const COLOR_MODES = ['light', 'dark', 'auto'] as const
const DENSITIES = ['comfortable', 'compact'] as const

// Deep-links straight to the Login Items pane -- same undocumented-but-
// stable x-apple.systempreferences scheme ACCESSIBILITY_SETTINGS_URL
// already relies on, confirmed against multiple independent write-ups
// (Apple Stack Exchange's accepted answer for opening this exact pane,
// and Der Flounder's own command-line survey) since Apple doesn't
// publish a URL-scheme reference for System Settings panes.
const LOGIN_ITEMS_SETTINGS_URL = 'x-apple.systempreferences:com.apple.LoginItems-Settings.extension'
const SECTION_IDS = SETTINGS_SECTIONS.map((s) => s.id)

// One page, a synced TOC, search-first (goal 0077): every section
// below is a registered entry in shared/settingsSections.ts, rendered
// here in that registry's order via SECTION_IDS/the SECTION_CONTENT map
// built inside the component -- the TOC (SettingsToc.tsx) and the
// filter box read the SAME registry, so a new section only needs
// adding in one place.
function SettingsSectionBlock({ id, filtered, registerRef, heading, children }: {
  id: string
  filtered: boolean
  registerRef: (el: HTMLElement | null) => void
  heading: ReactNode
  children: ReactNode
}) {
  return (
    <div
      id={`settings-${id}`}
      data-testid={`settings-section-${id}`}
      data-filtered-out={filtered ? 'true' : undefined}
      className={filtered ? `${settingsStyles.sectionAnchor} ${settingsStyles.sectionFilteredOut}` : settingsStyles.sectionAnchor}
      ref={registerRef}
    >
      {heading}
      {!filtered && children}
    </div>
  )
}

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
//
// initialSection lands a palette "Open Settings -> <Title>" deep-link
// (shared/commands.ts) directly on that section -- same
// App.tsx-passes-the-deep-link-field-down shape AtlasView's own
// initialCardID already uses.
function SettingsView({ initialSection }: { initialSection?: string } = {}) {
  // 'views' is the default namespace (settings.* keys); 'common:'
  // prefix reaches the shared common.json namespace explicitly
  // (docs/goals/archive/0032-copy-management.md's proof-of-pattern slice).
  const { t } = useTranslation('views')
  const { colorMode, setColorMode } = useTheme()
  const isNarrowViewport = useIsNarrowViewport()
  const reducedMotion = usePrefersReducedMotion()

  // 'disabled' | 'enabled' | 'requires-approval' (launchatlogin.LoginItemStatus)
  // -- null only for the one render before the mount fetch below resolves.
  const [launchAtLoginStatus, setLaunchAtLoginStatus] = useState<string | null>(null)
  const [launchAtLoginError, setLaunchAtLoginError] = useState('')

  const [summonBinding, setSummonBinding] = useState<string | null>(null)
  const [summonRecording, setSummonRecording] = useState(false)
  const [summonError, setSummonError] = useState('')

  const [mcpWriteEnabled, setMCPWriteEnabledState] = useState<boolean | null>(null)

  // Display density (docs/goals/0096): null until the mount fetch
  // resolves, same "disabled until loaded" shape as launchAtLogin/
  // mcpWriteEnabled below -- the SegmentedControl has no real "unset"
  // rendering, so this stays null only for the one render before the
  // fetch below resolves.
  const [density, setDensityState] = useState<DisplayDensity | null>(null)
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

  const [filterQuery, setFilterQuery] = useState('')
  const { activeId, registerSection, scrollToSection } = useSettingsSectionSync(SECTION_IDS, initialSection, reducedMotion)

  // Registry-based, deterministic filter (design contract item 3):
  // matches the resolved title + keywords, never DOM scraping.
  const filteredOutIds = useMemo(() => {
    const out = new Set<string>()
    for (const section of SETTINGS_SECTIONS) {
      if (!sectionMatchesQuery(section, t(section.titleKey), filterQuery)) out.add(section.id)
    }
    return out
  }, [filterQuery, t])

  useEffect(() => {
    SettingsService.GetLaunchAtLogin()
      .then(setLaunchAtLoginStatus)
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
    SettingsService.GetDisplayDensity()
      .then((d) => setDensityState(d === 'compact' ? 'compact' : 'comfortable'))
      .catch((err) => { console.error(err); setSettingsLoadError(true) })
  }, [])

  // Same menu-accelerator-suspension bracket as
  // composition/hotkeyCapture.ts's useHotkeyCapture -- see its own
  // comment for the full reasoning (a real, live-reproduced bug: an
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
        setSummonError(t('settings.globalHotkey.reservedError', { combo: describeCombo(mods, key), reason: reserved }))
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

  // Applies to the DOM immediately (ahead of the persist RPC resolving,
  // docs/goals/0096's "applies live, no reload" acceptance bar) --
  // never reverted on a failed SetDisplayDensity, unlike
  // toggleLaunchAtLogin above, which never sets optimistic state at all
  // (a failed or pending-approval launch-at-login write has a real
  // OS-level consequence a silently-wrong checkbox would hide).
  const setDensity = (value: DisplayDensity) => {
    applyDensity(value)
    setDensityState(value)
    SettingsService.SetDisplayDensity(value).catch(console.error)
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

  const SECTION_CONTENT: Record<string, ReactNode> = {
    appearance: (
      <>
        <SegmentedControl aria-label={t('settings.appearance.themeLabel')} onChange={(i) => setColorMode(COLOR_MODES[i])}>
          <SegmentedControl.IconButton icon={SunIcon} aria-label={t('settings.appearance.lightLabel')} selected={colorMode === 'light'} />
          <SegmentedControl.IconButton icon={MoonIcon} aria-label={t('settings.appearance.darkLabel')} selected={colorMode === 'dark'} />
          <SegmentedControl.IconButton icon={DeviceDesktopIcon} aria-label={t('settings.appearance.systemLabel')} selected={!colorMode || colorMode === 'auto'} />
        </SegmentedControl>
        <Stack direction="vertical" gap="condensed" style={{ marginTop: 'var(--base-size-16)' }}>
          <Text as="p" size="small" weight="semibold">{t('settings.appearance.densityLabel')}</Text>
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
        </Stack>
      </>
    ),
    general: (
      <>
        <FormControl>
          <Checkbox
            checked={launchAtLoginStatus === 'enabled' || launchAtLoginStatus === 'requires-approval'}
            disabled={launchAtLoginStatus === null}
            onChange={(e) => toggleLaunchAtLogin(e.target.checked)}
            data-testid="launch-at-login-checkbox"
          />
          <FormControl.Label>{t('settings.general.launchAtLoginLabel')}</FormControl.Label>
          <FormControl.Caption>{t('settings.general.launchAtLoginCaption')}</FormControl.Caption>
        </FormControl>
        {launchAtLoginStatus === 'requires-approval' && (
          <Stack direction="horizontal" gap="condensed" align="center" data-testid="launch-at-login-requires-approval">
            <Text as="p" size="small" className={styles.attention}>
              {t('settings.general.launchAtLoginRequiresApproval')}
            </Text>
            <Button size="small" onClick={() => Browser.OpenURL(LOGIN_ITEMS_SETTINGS_URL)}>
              {t('settings.general.openLoginItemsSettings')}
            </Button>
          </Stack>
        )}
        {launchAtLoginError && (
          <Text as="p" size="small" className={styles.error}>
            {launchAtLoginError.includes('dev binary')
              ? t('settings.general.errorDevBinary')
              : launchAtLoginError.includes('server mode')
                ? t('settings.general.errorServerMode')
                : launchAtLoginError}
          </Text>
        )}
        <SaveModeControl />
        <CanvasNavigationControl />
      </>
    ),
    extensions: <ExtensionsSection />,
    'keyboard-shortcuts': (
      <>
        <Text as="p" size="small" className={styles.muted}>
          {t('settings.keyboardShortcuts.description')}
        </Text>
        <KeyboardShortcutsSection />
      </>
    ),
    'global-hotkey': (
      <>
        <Text as="p" size="small" className={styles.muted}>
          {t('settings.globalHotkey.description')}
        </Text>
        <Stack direction="horizontal" gap="condensed" align="center" style={{ marginTop: 'var(--base-size-8)' }}>
          {summonRecording ? (
            <Text size="small" className={styles.recording}>{t('settings.globalHotkey.recording')}</Text>
          ) : summonBinding ? (
            <>
              <KeyIcon size={12} />
              <KeyComboChip label={summonBinding} />
              <Button size="small" variant="invisible" onClick={() => setSummonRecording(true)}>{t('common:actions.change')}</Button>
              <Button size="small" variant="invisible" onClick={clearSummonHotkey}>{t('common:actions.clear')}</Button>
            </>
          ) : (
            <Button size="small" variant="invisible" onClick={() => setSummonRecording(true)} data-testid="set-summon-hotkey">
              {t('settings.globalHotkey.setShortcut')}
            </Button>
          )}
        </Stack>
        {summonError && (
          <Stack direction="vertical" gap="condensed" style={{ marginTop: 'var(--base-size-8)' }}>
            <Text as="p" size="small" className={styles.error}>{summonError}</Text>
            {isAccessibilityError(summonError) && (
              <Button size="small" onClick={() => Browser.OpenURL(ACCESSIBILITY_SETTINGS_URL)}>
                {t('settings.globalHotkey.openAccessibilitySettings')}
              </Button>
            )}
          </Stack>
        )}
      </>
    ),
    'mcp-access': (
      <>
        <McpAddressField />
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
          <FormControl.Label>{t('settings.mcp.allowImportLabel')}</FormControl.Label>
          <FormControl.Caption>
            {t('settings.mcp.allowImportCaption')}
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
            <FormControl.Label>{t('settings.mcp.askBeforeImportLabel')}</FormControl.Label>
            <FormControl.Caption>
              {t('settings.mcp.askBeforeImportCaption')}
            </FormControl.Caption>
          </FormControl>
        )}
      </>
    ),
    'remote-access': <RemoteAccessSection />,
    contract: <ContractSection />,
    notifications: (
      <>
        <Text as="p" size="small" className={styles.muted}>
          {t('settings.notifications.description')}
        </Text>
        <FormControl>
          <FormControl.Label>{t('settings.notifications.awayAfterLabel')}</FormControl.Label>
          <TextInput
            className={styles.themedNumberInput}
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
            {t('settings.notifications.awayAfterCaption')}
          </FormControl.Caption>
        </FormControl>
        <Text as="p" size="small" className={styles.muted}>
          {t('settings.notifications.alertPermissionNote')}
        </Text>
      </>
    ),
    backups: <DataStewardshipSection />,
    updates: <UpdatesSection />,
  }

  return (
    <PageContainer variant="narrow" data-testid="settings-view">
      {/* Design-wave-1 fix #6: the sidebar footer row already says
          "Settings" -- the h1 is now the descriptive subtitle itself. */}
      <Heading as="h1" variant="medium" className={styles.subtitle}>
        {t('settings.subtitle')}
      </Heading>
      {settingsLoadError && (
        <Text as="p" size="small" className={styles.error} data-testid="settings-load-error">
          {t('settings.loadError')}
        </Text>
      )}

      <div className={isNarrowViewport ? undefined : settingsStyles.layout}>
        {!isNarrowViewport && (
          <SettingsToc
            sections={SETTINGS_SECTIONS}
            activeId={activeId}
            filteredOutIds={filteredOutIds}
            onSelect={scrollToSection}
          />
        )}
        <div className={settingsStyles.content}>
          <div className={settingsStyles.filterRow}>
            <TextInput
              leadingVisual={SearchIcon}
              placeholder={t('settings.filterPlaceholder')}
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              aria-label={t('settings.filterPlaceholder')}
              data-testid="settings-filter"
              block
            />
          </div>
          {SETTINGS_SECTIONS.map((section) => (
            <SettingsSectionBlock
              key={section.id}
              id={section.id}
              filtered={filteredOutIds.has(section.id)}
              registerRef={registerSection(section.id)}
              heading={<Heading as="h2" variant="small" className={styles.sectionHeading}>{t(section.titleKey)}</Heading>}
            >
              {SECTION_CONTENT[section.id]}
            </SettingsSectionBlock>
          ))}
        </div>
      </div>
    </PageContainer>
  )
}

export default SettingsView
