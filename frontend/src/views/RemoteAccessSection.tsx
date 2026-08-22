import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, Button, IconButton, Stack, Text, TextInput } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import { CheckIcon, DeviceMobileIcon, PencilIcon, PlusIcon, XIcon } from '@primer/octicons-react'
import { RemoteAuthService, SettingsService } from '../shared/bindings'
import type { DeviceInfo, PairingCodeInfo } from '../shared/bindings'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { formatUpdated } from '../shared/inventorySort'
import { getNotificationPermission, requestNotificationPermission } from '../shared/browserNotify'
import type { BrowserNotifyPermission } from '../shared/browserNotify'
import listStyles from '../shared/ListCard.module.css'
import monoStyles from '../shared/monoText.module.css'

// docs/goals/0132-remote-access.md SLICE 1: Settings' own door into
// the auth gate every non-loopback request is now behind
// (remoteauthsvc.RemoteAuthService.Middleware, wired in main.go). This
// Mac reaches Mill over loopback and is never challenged by that gate
// -- the two sentences below are this section's honest account of
// what that means for every OTHER device.

function RemoteAccessSection() {
  const { t } = useTranslation('views')
  const [devices, setDevices] = useState<DeviceInfo[] | null>(null)
  const [pairing, setPairing] = useState<PairingCodeInfo | null>(null)
  const [error, setError] = useState('')
  const [revoking, setRevoking] = useState<DeviceInfo | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  // docs/goals/0132 SLICE A: this control has no reason to render on a
  // desktop build -- the desktop path already gets a native banner with
  // no opt-in, and browserNotifyPredicate.shouldNotifyBrowserTab never
  // fires there anyway.
  const [isServerMode, setIsServerMode] = useState(false)
  const [notifyPermission, setNotifyPermission] = useState<BrowserNotifyPermission>(() => getNotificationPermission())

  useEffect(() => {
    SettingsService.GetBuildInfo().then((info) => setIsServerMode(info?.Server === true)).catch(() => {})
  }, [])

  const enableNotify = () => {
    requestNotificationPermission().then(setNotifyPermission).catch(() => {})
  }

  const refresh = () => {
    RemoteAuthService.ListDevices()
      .then((d) => setDevices(d ?? []))
      .catch((err) => setError(String(err)))
  }
  useEffect(refresh, [])

  const pairADevice = () => {
    setError('')
    RemoteAuthService.GeneratePairingCode()
      .then(setPairing)
      .catch((err) => setError(String(err)))
  }

  const confirmRevoke = () => {
    if (!revoking) return
    const device = revoking
    setRevoking(null)
    RemoteAuthService.RevokeDevice(device.id)
      .then(refresh)
      .catch((err) => setError(String(err)))
  }

  const startRename = (d: DeviceInfo) => {
    setRenamingId(d.id)
    setRenameDraft(d.label)
  }
  const cancelRename = () => {
    setRenamingId(null)
    setRenameDraft('')
  }
  const saveRename = (id: string) => {
    const trimmed = renameDraft.trim()
    if (!trimmed) return
    RemoteAuthService.RenameDevice(id, trimmed)
      .then(() => {
        setRenamingId(null)
        setRenameDraft('')
        refresh()
      })
      .catch((err) => setError(String(err)))
  }

  // Never gate the whole section behind the ListDevices() fetch --
  // returning null while loading collapses this section to zero
  // height on first paint, then pops in once the fetch resolves,
  // shifting every section below it (regression pinned by
  // e2e/settings.spec.ts's deep-link scroll test: a section further
  // down the page landed mid-viewport because its scroll target moved
  // out from under it after the deep-link's one-shot scroll already
  // ran). The device list itself renders once loaded; everything else
  // is static and mounts immediately, same as every other section on
  // this page.
  const list = devices ?? []

  return (
    <>
      <Text as="p" size="small" className={listStyles.muted}>
        {t('settings.remoteAccess.description')}
      </Text>
      <Text as="p" size="small" className={listStyles.muted}>
        {t('settings.remoteAccess.macAlwaysAllowed')}
      </Text>

      {isServerMode && (
        <Stack direction="vertical" gap="condensed" style={{ marginTop: 'var(--base-size-16)' }} data-testid="browser-notify-control">
          {notifyPermission === 'unsupported' && (
            <Text as="p" size="small" className={listStyles.muted} data-testid="browser-notify-unsupported">
              {t('settings.remoteAccess.notify.unsupported')}
            </Text>
          )}
          {notifyPermission === 'default' && (
            <>
              <Button size="small" onClick={enableNotify} data-testid="browser-notify-enable">
                {t('settings.remoteAccess.notify.enable')}
              </Button>
              <Text as="p" size="small" className={listStyles.muted}>
                {t('settings.remoteAccess.notify.caption')}
              </Text>
            </>
          )}
          {notifyPermission === 'granted' && (
            <Text as="p" size="small" data-testid="browser-notify-granted">
              {t('settings.remoteAccess.notify.granted')}
            </Text>
          )}
          {notifyPermission === 'denied' && (
            <Text as="p" size="small" className={listStyles.error} data-testid="browser-notify-denied">
              {t('settings.remoteAccess.notify.denied')}
            </Text>
          )}
        </Stack>
      )}

      <Button
        size="small"
        leadingVisual={PlusIcon}
        onClick={pairADevice}
        style={{ marginTop: 'var(--base-size-8)' }}
        data-testid="pair-a-device"
      >
        {t('settings.remoteAccess.pairADevice')}
      </Button>

      {pairing && (
        <Stack direction="vertical" gap="condensed" style={{ marginTop: 'var(--base-size-8)' }} data-testid="pairing-code-panel">
          <Text size="large" weight="semibold" className={monoStyles.mono} data-testid="pairing-code">
            {pairing.code}
          </Text>
          <Text as="p" size="small" className={listStyles.muted}>
            {t('settings.remoteAccess.codeExpiry')}
          </Text>
        </Stack>
      )}

      {list.length === 0 ? (
        <Blankslate data-testid="remote-access-empty">
          <Blankslate.Visual><DeviceMobileIcon size={32} /></Blankslate.Visual>
          <Blankslate.Heading>{t('settings.remoteAccess.emptyHeading')}</Blankslate.Heading>
          <Blankslate.Description>{t('settings.remoteAccess.emptyDescription')}</Blankslate.Description>
        </Blankslate>
      ) : (
        <ActionList data-testid="paired-devices-list" style={{ marginTop: 'var(--base-size-8)' }}>
          {list.map((d) => (
            <ActionList.Item key={d.id} data-testid="paired-device-row" data-device-id={d.id}>
              {renamingId === d.id ? (
                <div style={{ pointerEvents: 'auto' }} onClick={(e) => e.stopPropagation()}>
                  <Stack direction="horizontal" gap="condensed" align="center">
                    <TextInput
                      size="small"
                      autoFocus
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveRename(d.id)
                        if (e.key === 'Escape') cancelRename()
                      }}
                      aria-label={t('settings.remoteAccess.renameInputAriaLabel')}
                      data-testid="device-rename-input"
                    />
                    <IconButton
                      icon={CheckIcon}
                      size="small"
                      aria-label={t('settings.remoteAccess.renameSaveAriaLabel')}
                      onClick={() => saveRename(d.id)}
                      data-testid="device-rename-save"
                    />
                    <IconButton
                      icon={XIcon}
                      size="small"
                      variant="invisible"
                      aria-label={t('settings.remoteAccess.renameCancelAriaLabel')}
                      onClick={cancelRename}
                      data-testid="device-rename-cancel"
                    />
                  </Stack>
                </div>
              ) : (
                <div style={{ pointerEvents: 'auto' }} onClick={(e) => e.stopPropagation()}>
                  <Stack direction="horizontal" gap="condensed" align="center">
                    <Text weight="semibold">{d.label}</Text>
                    <IconButton
                      icon={PencilIcon}
                      size="small"
                      variant="invisible"
                      aria-label={t('settings.remoteAccess.renameAriaLabel', { label: d.label })}
                      onClick={() => startRename(d)}
                      data-testid="device-rename-start"
                    />
                  </Stack>
                </div>
              )}
              <ActionList.Description variant="block">
                {t('settings.remoteAccess.deviceMeta', {
                  created: formatUpdated(d.createdAt),
                  lastSeen: formatUpdated(d.lastSeenAt),
                })}
              </ActionList.Description>
              <ActionList.TrailingVisual>
                <div style={{ pointerEvents: 'auto' }} onClick={(e) => e.stopPropagation()}>
                  <Button size="small" variant="danger" onClick={() => setRevoking(d)} data-testid="revoke-device">
                    {t('settings.remoteAccess.revoke')}
                  </Button>
                </div>
              </ActionList.TrailingVisual>
            </ActionList.Item>
          ))}
        </ActionList>
      )}

      {error && (
        <Text as="p" size="small" className={listStyles.error} style={{ marginTop: 'var(--base-size-8)' }}>
          {error}
        </Text>
      )}

      {revoking && (
        <ConfirmDialog
          title={t('settings.remoteAccess.revokeConfirmTitle', { label: revoking.label })}
          body={t('settings.remoteAccess.revokeConfirmBody', { label: revoking.label })}
          confirmLabel={t('settings.remoteAccess.revoke')}
          onCancel={() => setRevoking(null)}
          onConfirm={confirmRevoke}
        />
      )}
    </>
  )
}

export default RemoteAccessSection
