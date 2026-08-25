import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { Events } from '@wailsio/runtime'
import { useTranslation } from 'react-i18next'
import { Browser } from '@wailsio/runtime'
import { Button, Checkbox, FormControl, Select, Stack, Text, TextInput } from '@primer/react'
import { SettingsService, UpdateState, type UpdateNotice } from '../shared/bindings'
import { findCommand } from '../shared/commands'
import { CopyDiagnosisButton } from '../shared/CopyDiagnosisButton'
import { formatUpdated } from '../shared/inventorySort'

// The browser-download escape hatch for when the in-app download is
// blocked (managed networks answer the asset fetch with 403 while the
// same URL works in a browser tab -- observed live on a corporate
// proxy). The releases page is the same distribution the updater
// itself reads.
const RELEASES_URL = 'https://github.com/alicoding/mill/releases'
import styles from '../shared/ListCard.module.css'
import monoStyles from '../shared/monoText.module.css'

// Keeps a rendered error to one humane line (goal 0127's rider: GitHub's
// own HTML error page, base64 image included, once rendered whole here)
// while CopyDiagnosisButton still gets the untruncated text -- the same
// visible/copyable split LiveRunControls' finished bar already uses.
function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}

// lastCheckText maps CheckForUpdates' persisted outcome to its display
// copy -- pulled out of the component so the outcome ternary chain
// doesn't count against UpdatesSection's own cognitive-complexity budget
// (sonarjs/cognitive-complexity, .claude/rules/testing.md).
function lastCheckText(
  outcome: LastCheckOutcome,
  relative: string,
  error: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (outcome === 'failed') return t('settings.updates.lastCheckFailed', { time: relative, error: truncate(error, 200) })
  if (outcome === 'found') return t('settings.updates.lastCheckFound', { time: relative })
  if (outcome === 'upToDate') return t('settings.updates.lastCheckUpToDate', { time: relative })
  return t('settings.updates.lastCheckNever')
}

// LastCheckStatus renders the persistent last-check record beneath the
// primary action -- a failing check must read as a real, visible
// state, never look identical to "no update available". A separate
// component keeps this branch out of UpdatesSection's own cognitive-
// complexity budget (sonarjs/cognitive-complexity, .claude/rules/testing.md).
function LastCheckStatus({ outcome, text, error }: { outcome: LastCheckOutcome; text: string; error: string }) {
  if (outcome === 'failed') {
    return (
      <Stack direction="horizontal" gap="condensed" align="center">
        <Text size="small" className={styles.error} data-testid="last-check-failed">
          {text}
        </Text>
        <CopyDiagnosisButton error={error} testId="last-check-failed-copy" />
      </Stack>
    )
  }
  return (
    <Text size="small" className={styles.muted} data-testid="last-check-status">
      {text}
    </Text>
  )
}

type TFunc = (key: string, options?: Record<string, unknown>) => string

interface PrimaryAction {
  label: string
  disabled: boolean
  onClick: () => void
}

// primaryActionFor is the ONE place the primary button's label+action
// is decided (goal 0220 S1) -- the pill (app/NoticePill.tsx) mirrors
// the same server state directly since it has no local check-result
// payload to reconcile; here, "available" is driven by pendingVersion
// (the raw CheckForUpdates() result, goal 0205 S4's own auto-check-on-
// open) rather than the server's dismissal-aware AvailableVersion field
// -- deliberate: dismissing the footer pill (SettingsService.
// DismissUpdateNotice) must never also hide the action from Settings,
// which a fresh explicit check here can always still surface (the
// existing, tested "dismiss the pill, still install from Settings"
// path). checking/downloading/ready stay purely server-driven since
// dismissal never touches those fields.
function primaryActionFor(
  state: UpdateState,
  canInstall: boolean,
  pendingVersion: string,
  checkForUpdates: () => void,
  t: TFunc,
): PrimaryAction {
  if (state === UpdateState.UpdateStateChecking) {
    return { label: t('settings.updates.checking'), disabled: true, onClick: () => {} }
  }
  if (state === UpdateState.UpdateStateDownloading) {
    return { label: t('settings.updates.downloading'), disabled: true, onClick: () => {} }
  }
  if (state === UpdateState.UpdateStateReady) {
    return { label: t('settings.updates.primaryRestart'), disabled: false, onClick: () => findCommand('update.relaunch')?.run() }
  }
  if (canInstall && pendingVersion) {
    return {
      label: t('settings.updates.primaryDownload', { version: pendingVersion }),
      disabled: false,
      onClick: () => findCommand('update.downloadAndInstall')?.run(),
    }
  }
  return { label: t('settings.updates.checkButton'), disabled: false, onClick: checkForUpdates }
}

// Extracted from SettingsView.tsx (same reason DataStewardshipSection
// already is: keeps that file's own line count from crowding the
// 500-line convention). Two install behaviors sharing one surface:
// release and beta builds can install and restart themselves; a
// source-channel build only ever notifies and points at a rebuild.

type Channel = '' | 'source' | 'release' | 'beta'
const installableChannels: Channel[] = ['release', 'beta']
// Mirrors the Go UpdateCheckOutcome values (settingsservice_updatenotice.go)
// -- '' means CheckForUpdates has never run.
type LastCheckOutcome = '' | 'found' | 'upToDate' | 'failed'

interface UpdateResult {
  version: string
  notes: string
}

// applyUpdateNotice folds one UpdateNoticeState poll into every piece of
// state it drives -- pulled out of the mount effect so its branching
// doesn't count against UpdatesSection's own cognitive-complexity budget
// (sonarjs/cognitive-complexity, .claude/rules/testing.md).
function applyUpdateNotice(
  n: UpdateNotice,
  setState: Dispatch<SetStateAction<UpdateState>>,
  setStateReason: Dispatch<SetStateAction<string>>,
  setUpdateResult: Dispatch<SetStateAction<UpdateResult | null>>,
  setLastCheckAt: Dispatch<SetStateAction<string>>,
  setLastCheckOutcome: Dispatch<SetStateAction<LastCheckOutcome>>,
  setLastCheckError: Dispatch<SetStateAction<string>>,
) {
  setState(n.state)
  setStateReason(n.stateReason)
  // Recovers version+notes after a fresh mount that didn't run the
  // check itself -- e.g. reloading while a background auto-download
  // (goal 0207) is already downloading or ready.
  if ((n.state === UpdateState.UpdateStateDownloading || n.state === UpdateState.UpdateStateReady) && n.stateVersion) {
    setUpdateResult((prev) => prev ?? { version: n.stateVersion, notes: '' })
  }
  setLastCheckAt(n.lastCheckAt)
  setLastCheckOutcome(n.lastCheckOutcome as LastCheckOutcome)
  setLastCheckError(n.lastCheckError)
}

function UpdatesSection() {
  const { t } = useTranslation('views')
  const [appVersion, setAppVersion] = useState('')
  const [channel, setChannel] = useState<Channel>('')
  const [updateResult, setUpdateResult] = useState<UpdateResult | null>(null)
  const [state, setState] = useState<UpdateState>(UpdateState.UpdateStateIdle)
  const [stateReason, setStateReason] = useState('')
  const [proxyUrl, setProxyUrl] = useState('')
  // '' = Auto (system), 'off' = direct, 'manual' = the URL field.
  const [proxyMode, setProxyMode] = useState<'auto' | 'manual' | 'off'>('auto')
  // 'saved' | an error message | '' -- one slot, the two success/error
  // renders split on the literal.
  const [proxyNote, setProxyNote] = useState('')
  const [channelPref, setChannelPref] = useState('')
  const [channelSaved, setChannelSaved] = useState(false)
  const [autoCheck, setAutoCheck] = useState(false)
  const [checkInterval, setCheckInterval] = useState('hourly')
  // The persistent record of CheckForUpdates' most recent run (manual
  // button, an explicit Settings check, or the background loop),
  // independent of `state` above -- the answer to "is checking
  // actually still happening", shown alongside the primary action.
  const [lastCheckAt, setLastCheckAt] = useState('')
  const [lastCheckOutcome, setLastCheckOutcome] = useState<LastCheckOutcome>('')
  const [lastCheckError, setLastCheckError] = useState('')

  // The state machine is SERVER truth (goal 0220 S1, building on goal
  // 0142's Downloading field): synced on mount and on every
  // update-notice event, so navigating away and back, or a background
  // auto-download finishing while Settings isn't open, is never missed.
  useEffect(() => {
    const sync = () => void SettingsService.UpdateNoticeState()
      .then((n) => applyUpdateNotice(n, setState, setStateReason, setUpdateResult, setLastCheckAt, setLastCheckOutcome, setLastCheckError))
      .catch(console.error)
    sync()
    return Events.On('mill-data-changed', (evt) => {
      if ((evt.data as { entity?: string })?.entity === 'update-notice') sync()
    })
  }, [])

  useEffect(() => {
    SettingsService.AppVersion().then(setAppVersion).catch(console.error)
    SettingsService.UpdateChannel().then((c) => setChannel(c as Channel)).catch(console.error)
    SettingsService.UpdateChannelPreference().then(setChannelPref).catch(console.error)
    SettingsService.AutoUpdateCheck().then(setAutoCheck).catch(console.error)
    SettingsService.UpdateCheckInterval().then(setCheckInterval).catch(console.error)
    SettingsService.OutboundProxyURL()
      .then((v) => {
        if (v === 'off') setProxyMode('off')
        else if (v !== '') {
          setProxyMode('manual')
          setProxyUrl(v)
        }
      })
      .catch(console.error)
  }, [])

  // useCallback (not a plain closure) so the auto-check-on-open effect
  // below can depend on a stable reference instead of disabling
  // exhaustive-deps. Deliberately bypasses the dismissal-aware server
  // state (see primaryActionFor's own comment) -- CheckForUpdates'
  // raw return is what populates the version/notes card and the
  // primary button's "available" branch.
  const checkForUpdates = useCallback(() => {
    setUpdateResult(null)
    SettingsService.CheckForUpdates()
      .then((result) => {
        if (result.updateAvailable) {
          setUpdateResult({ version: result.version, notes: result.notes })
        }
      })
      .catch(console.error)
  }, [])

  // Opening the section must never read a stale cached outcome as
  // current (goal 0205 S4) -- a fresh check runs every time this
  // component mounts, the same one the primary button triggers, so the
  // rendered outcome always reflects a check that just ran.
  useEffect(() => {
    checkForUpdates()
  }, [checkForUpdates])

  const saveChannelPref = (pref: string) => {
    setChannelPref(pref)
    setChannelSaved(false)
    SettingsService.SetUpdateChannelPreference(pref)
      .then(() => setChannelSaved(true))
      .catch(console.error)
  }

  const persistProxy = (value: string) => {
    SettingsService.SetOutboundProxyURL(value)
      .then(() => setProxyNote('saved'))
      .catch((err) => setProxyNote(String(err)))
  }

  const changeProxyMode = (mode: 'auto' | 'manual' | 'off') => {
    setProxyMode(mode)
    setProxyNote('')
    // Auto and Off persist immediately; Manual persists on Save so a
    // half-typed URL never lands in the store.
    if (mode === 'auto') persistProxy('')
    if (mode === 'off') persistProxy('off')
  }

  const changeCheckInterval = (value: string) => {
    setCheckInterval(value)
    SettingsService.SetUpdateCheckInterval(value).catch(console.error)
  }

  const channelLabel =
    channel === 'release'
      ? t('settings.updates.channelRelease')
      : channel === 'beta'
        ? t('settings.updates.channelBeta')
        : t('settings.updates.channelSource')
  const canInstall = installableChannels.includes(channel)

  // Reuses the same relative-time phrase every "last updated"/"N ago"
  // caption in the app already renders (shared/inventorySort.ts) rather
  // than a second formatter.
  const lastCheckRelative = lastCheckAt ? formatUpdated(lastCheckAt) : ''
  const lastCheckDisplay = lastCheckText(lastCheckOutcome, lastCheckRelative, lastCheckError, t)
  const primary = primaryActionFor(state, canInstall, updateResult?.version ?? '', checkForUpdates, t)
  // A non-supersede install failure is the only path that sets
  // stateReason while a version is still known locally (see
  // failInstall's own comment, settingsservice_updates.go) -- every
  // other error reading (a plain failed check) leaves updateResult
  // null, so this can't misfire onto the check-only failure line below.
  const installFailed = state === UpdateState.UpdateStateError && updateResult !== null && canInstall

  return (
    <Stack gap="condensed">
      <Text size="small" className={styles.muted} data-testid="current-app-version">
        {t('settings.updates.currentVersion', { version: appVersion })} · {channelLabel} ·{' '}
        {lastCheckAt ? t('settings.updates.statusCheckedAgo', { time: lastCheckRelative }) : t('settings.updates.statusNeverChecked')}
      </Text>

      <FormControl>
        <FormControl.Label>{t('settings.updates.channelPickerLabel')}</FormControl.Label>
        <Select
          size="small"
          value={channelPref}
          onChange={(e) => saveChannelPref(e.target.value)}
          data-testid="update-channel-select"
        >
          <Select.Option value="">{t('settings.updates.channelDefault')}</Select.Option>
          <Select.Option value="beta">{t('settings.updates.channelOptionBeta')}</Select.Option>
          <Select.Option value="release">{t('settings.updates.channelOptionRelease')}</Select.Option>
        </Select>
      </FormControl>
      {channelSaved && (
        <Text size="small" className={styles.muted} data-testid="update-channel-saved">
          {t('settings.updates.channelSaved')}
        </Text>
      )}

      <FormControl>
        <FormControl.Label>{t('settings.updates.proxyLabel')}</FormControl.Label>
        <Select
          size="small"
          value={proxyMode}
          onChange={(e) => changeProxyMode(e.target.value as 'auto' | 'manual' | 'off')}
          data-testid="proxy-mode-select"
        >
          <Select.Option value="auto">{t('settings.updates.proxyModeAuto')}</Select.Option>
          <Select.Option value="manual">{t('settings.updates.proxyModeManual')}</Select.Option>
          <Select.Option value="off">{t('settings.updates.proxyModeOff')}</Select.Option>
        </Select>
        <FormControl.Caption>{t('settings.updates.proxyCaption')}</FormControl.Caption>
      </FormControl>
      {proxyMode === 'manual' && (
        <Stack direction="horizontal" gap="condensed" align="center">
          <TextInput
            size="small"
            value={proxyUrl}
            onChange={(e) => setProxyUrl(e.target.value)}
            placeholder={t('settings.updates.proxyPlaceholder')}
            aria-label={t('settings.updates.proxyLabel')}
            data-testid="proxy-url-input"
          />
          <Button size="small" onClick={() => persistProxy(proxyUrl.trim())} data-testid="proxy-url-save">
            {t('settings.updates.proxySave')}
          </Button>
        </Stack>
      )}
      {proxyNote && (
        <Text
          size="small"
          className={proxyNote === 'saved' ? styles.muted : styles.error}
          data-testid={proxyNote === 'saved' ? 'proxy-saved-note' : 'proxy-error'}
        >
          {proxyNote === 'saved' ? t('settings.updates.proxySaved') : proxyNote}
        </Text>
      )}

      <FormControl>
        <Checkbox
          checked={autoCheck}
          onChange={(e) => {
            const on = e.target.checked
            setAutoCheck(on)
            SettingsService.SetAutoUpdateCheck(on).catch(console.error)
          }}
          data-testid="auto-update-check"
        />
        <FormControl.Label>{t('settings.updates.autoCheckLabel')}</FormControl.Label>
        <FormControl.Caption>{t('settings.updates.autoCheckCaption')}</FormControl.Caption>
      </FormControl>
      {autoCheck && (
        <FormControl>
          <FormControl.Label>{t('settings.updates.checkIntervalLabel')}</FormControl.Label>
          <Select
            size="small"
            value={checkInterval}
            onChange={(e) => changeCheckInterval(e.target.value)}
            data-testid="update-check-interval-select"
          >
            <Select.Option value="hourly">{t('settings.updates.checkIntervalHourly')}</Select.Option>
            <Select.Option value="daily">{t('settings.updates.checkIntervalDaily')}</Select.Option>
            <Select.Option value="weekly">{t('settings.updates.checkIntervalWeekly')}</Select.Option>
            <Select.Option value="manual">{t('settings.updates.checkIntervalManual')}</Select.Option>
          </Select>
        </FormControl>
      )}

      <Stack direction="horizontal" gap="condensed" align="center">
        <Button
          variant="primary"
          size="small"
          onClick={primary.onClick}
          disabled={primary.disabled}
          data-testid="update-primary-action"
        >
          {primary.label}
        </Button>
        {state === UpdateState.UpdateStateReady && (
          <Text size="small" className={styles.muted}>{t('settings.updates.installedRestart')}</Text>
        )}
      </Stack>

      <LastCheckStatus outcome={lastCheckOutcome} text={lastCheckDisplay} error={lastCheckError} />

      {state === UpdateState.UpdateStateError && updateResult === null && (
        <Stack direction="horizontal" gap="condensed" align="center">
          <Text size="small" className={styles.error} data-testid="update-check-error">
            {t('settings.updates.checkFailed', { error: truncate(stateReason, 200) })}
          </Text>
          <CopyDiagnosisButton error={stateReason} testId="update-check-error-copy" />
        </Stack>
      )}

      {updateResult && (
        <div
          data-testid="update-available-card"
          style={{ border: '1px solid var(--borderColor-default)', borderRadius: 6, padding: 12 }}
        >
          <Stack gap="condensed">
            <Text weight="semibold" size="small">
              {t('settings.updates.updateAvailable', { version: updateResult.version })}
            </Text>

            {updateResult.notes && (
              <details>
                <summary>{t('settings.updates.whatsNew')}</summary>
                <div
                  data-testid="update-notes"
                  className={styles.muted}
                  style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflowY: 'auto' }}
                >
                  {updateResult.notes}
                </div>
              </details>
            )}

            {!canInstall && (
              <>
                <Text size="small" className={styles.muted}>{t('settings.updates.sourceUpdateHint')}</Text>
                <Text size="small" className={`${styles.muted} ${monoStyles.mono}`}>
                  {t('settings.updates.sourceUpdateCommand')}
                </Text>
              </>
            )}

            {installFailed && (
              <>
                <Stack direction="horizontal" gap="condensed" align="center">
                  <Text size="small" className={styles.error}>
                    {t('settings.updates.installFailed', { error: truncate(stateReason, 200) })}
                  </Text>
                  <CopyDiagnosisButton error={stateReason} testId="update-error-copy" />
                </Stack>
                <Stack direction="horizontal" gap="condensed" align="center">
                  <Text size="small" className={styles.muted}>
                    {t('settings.updates.installFallbackHint')}
                  </Text>
                  <Button size="small" onClick={() => Browser.OpenURL(RELEASES_URL)} data-testid="open-releases-page">
                    {t('settings.updates.openReleasesButton')}
                  </Button>
                </Stack>
              </>
            )}
          </Stack>
        </div>
      )}

      <details data-testid="trust-disclosure">
        <summary>{t('settings.updates.trustDisclosureSummary')}</summary>
        <Stack gap="condensed">
          <Text size="small" className={styles.muted} data-testid="resign-notice">
            {t('settings.updates.resignNotice')}
          </Text>
          <Text size="small" className={styles.muted} data-testid="resign-setup-notice">
            {t('settings.updates.resignSetupNotice')}
          </Text>
        </Stack>
      </details>
    </Stack>
  )
}

export default UpdatesSection
