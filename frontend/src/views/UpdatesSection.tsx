import { useEffect, useState } from 'react'
import { Events } from '@wailsio/runtime'
import { useTranslation } from 'react-i18next'
import { Browser } from '@wailsio/runtime'
import { Button, Checkbox, FormControl, Select, Stack, Text, TextInput } from '@primer/react'
import { SettingsService } from '../shared/bindings'
import { CopyDiagnosisButton } from '../shared/CopyDiagnosisButton'

// The browser-download escape hatch for when the in-app download is
// blocked (managed networks answer the asset fetch with 403 while the
// same URL works in a browser tab -- observed live on a corporate
// proxy). The releases page is the same distribution the updater
// itself reads.
const RELEASES_URL = 'https://github.com/alicoding/mill/releases'
import styles from '../shared/ListCard.module.css'
import monoStyles from '../shared/monoText.module.css'

// Extracted from SettingsView.tsx (same reason DataStewardshipSection
// already is: keeps that file's own line count from crowding the
// 500-line convention). Two install behaviors sharing one surface:
// release and beta builds can install and restart themselves; a
// source-channel build only ever notifies and points at a rebuild.

type Channel = '' | 'source' | 'release' | 'beta'
const installableChannels: Channel[] = ['release', 'beta']
type InstallState = 'idle' | 'installing' | 'installed' | 'failed'

interface UpdateResult {
  version: string
  notes: string
}

function UpdatesSection() {
  const { t } = useTranslation('views')
  const [appVersion, setAppVersion] = useState('')
  const [channel, setChannel] = useState<Channel>('')
  const [checking, setChecking] = useState(false)
  const [status, setStatus] = useState('')
  const [updateResult, setUpdateResult] = useState<UpdateResult | null>(null)
  const [installState, setInstallState] = useState<InstallState>('idle')
  const [proxyUrl, setProxyUrl] = useState('')
  // '' = Auto (system), 'off' = direct, 'manual' = the URL field.
  const [proxyMode, setProxyMode] = useState<'auto' | 'manual' | 'off'>('auto')
  // 'saved' | an error message | '' -- one slot, the two success/error
  // renders split on the literal.
  const [proxyNote, setProxyNote] = useState('')
  const [installError, setInstallError] = useState('')
  const [channelPref, setChannelPref] = useState('')
  const [channelSaved, setChannelSaved] = useState(false)
  const [autoCheck, setAutoCheck] = useState(false)

  // The download phase is SERVER truth (goal 0142): synced on mount
  // and on every update-notice event, so navigating away and back
  // never forgets a running download, and a finished one shows the
  // Restart button here as well as in the footer pill.
  useEffect(() => {
    const sync = () => void SettingsService.UpdateNoticeState().then((n) => {
      setInstallState((prev) => {
        if (n.downloading) return 'installing'
        if (n.ready) return 'installed'
        return prev === 'installing' ? 'idle' : prev
      })
      if ((n.downloading || n.ready) && n.availableVersion) {
        setUpdateResult((prev) => prev ?? { version: n.availableVersion, notes: '' })
      }
    }).catch(console.error)
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

  const saveChannelPref = (pref: string) => {
    setChannelPref(pref)
    setChannelSaved(false)
    SettingsService.SetUpdateChannelPreference(pref)
      .then(() => setChannelSaved(true))
      .catch((err) => setStatus(String(err)))
  }

  const checkForUpdates = () => {
    setChecking(true)
    setStatus('')
    setUpdateResult(null)
    // A running or staged install is server truth -- a fresh check
    // must not un-show it (the double-click trap this section had).
    setInstallState((prev) => (prev === 'installing' || prev === 'installed' ? prev : 'idle'))
    setInstallError('')
    SettingsService.CheckForUpdates()
      .then((result) => {
        if (result.updateAvailable) {
          setUpdateResult({ version: result.version, notes: result.notes })
        } else {
          setStatus(t('settings.updates.upToDate'))
        }
      })
      .catch((err) => setStatus(String(err)))
      .finally(() => setChecking(false))
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

  const installUpdate = () => {
    setInstallState('installing')
    setInstallError('')
    SettingsService.DownloadAndInstallUpdate()
      .then(() => setInstallState('installed'))
      .catch((err) => {
        setInstallState('failed')
        setInstallError(String(err))
      })
  }

  const restartApp = () => {
    SettingsService.RestartApp().catch((err) => setInstallError(String(err)))
  }

  const channelLabel =
    channel === 'release'
      ? t('settings.updates.channelRelease')
      : channel === 'beta'
        ? t('settings.updates.channelBeta')
        : t('settings.updates.channelSource')
  const canInstall = installableChannels.includes(channel)
  const statusText = checking ? t('settings.updates.checking') : status

  return (
    <Stack gap="condensed">
      <Text size="small" className={styles.muted} data-testid="current-app-version">
        {t('settings.updates.currentVersion', { version: appVersion })} · {channelLabel}
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

      <Stack direction="horizontal" gap="condensed" align="center">
        <Button size="small" onClick={checkForUpdates} disabled={checking} data-testid="check-for-updates">
          {checking ? t('settings.updates.checking') : t('settings.updates.checkButton')}
        </Button>
        {statusText && <Text size="small" className={styles.muted}>{statusText}</Text>}
      </Stack>

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

            {canInstall ? (
              <>
                {installState !== 'installed' ? (
                  <Button
                    variant="primary"
                    size="small"
                    onClick={installUpdate}
                    disabled={installState === 'installing'}
                    data-testid="update-now"
                  >
                    {installState === 'installing' ? t('settings.updates.downloading') : t('settings.updates.updateNow')}
                  </Button>
                ) : (
                  <>
                    <Button variant="primary" size="small" onClick={restartApp} data-testid="restart-mill">
                      {t('settings.updates.restartButton')}
                    </Button>
                    <Text size="small" className={styles.muted}>{t('settings.updates.installedRestart')}</Text>
                  </>
                )}
                {installState === 'failed' && (
                  <>
                    <Stack direction="horizontal" gap="condensed" align="center">
                      <Text size="small" className={styles.error}>
                        {t('settings.updates.installFailed', { error: installError })}
                      </Text>
                      <CopyDiagnosisButton error={installError} testId="update-error-copy" />
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
              </>
            ) : (
              <>
                <Text size="small" className={styles.muted}>{t('settings.updates.sourceUpdateHint')}</Text>
                <Text size="small" className={`${styles.muted} ${monoStyles.mono}`}>
                  {t('settings.updates.sourceUpdateCommand')}
                </Text>
              </>
            )}
          </Stack>
        </div>
      )}
    </Stack>
  )
}

export default UpdatesSection
