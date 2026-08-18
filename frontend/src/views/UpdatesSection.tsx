import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Stack, Text } from '@primer/react'
import { SettingsService } from '../shared/bindings'
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
  const [installError, setInstallError] = useState('')

  useEffect(() => {
    SettingsService.AppVersion().then(setAppVersion).catch(console.error)
    SettingsService.UpdateChannel().then((c) => setChannel(c as Channel)).catch(console.error)
  }, [])

  const checkForUpdates = () => {
    setChecking(true)
    setStatus('')
    setUpdateResult(null)
    setInstallState('idle')
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
                  <Text size="small" className={styles.error}>
                    {t('settings.updates.installFailed', { error: installError })}
                  </Text>
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
