import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, Button, Stack, Text } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import { DeviceMobileIcon, PlusIcon } from '@primer/octicons-react'
import { RemoteAuthService } from '../shared/bindings'
import type { DeviceInfo, PairingCodeInfo } from '../shared/bindings'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import listStyles from '../shared/ListCard.module.css'
import monoStyles from '../shared/monoText.module.css'

// docs/goals/0132-remote-access.md SLICE 1: Settings' own door into
// the auth gate every non-loopback request is now behind
// (remoteauthsvc.RemoteAuthService.Middleware, wired in main.go). This
// Mac reaches Mill over loopback and is never challenged by that gate
// -- the two sentences below are this section's honest account of
// what that means for every OTHER device.
function formatTimestamp(iso: string) {
  return new Date(iso).toLocaleString()
}

function RemoteAccessSection() {
  const { t } = useTranslation('views')
  const [devices, setDevices] = useState<DeviceInfo[] | null>(null)
  const [pairing, setPairing] = useState<PairingCodeInfo | null>(null)
  const [error, setError] = useState('')
  const [revoking, setRevoking] = useState<DeviceInfo | null>(null)

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

  if (devices === null) return null

  return (
    <>
      <Text as="p" size="small" className={listStyles.muted}>
        {t('settings.remoteAccess.description')}
      </Text>
      <Text as="p" size="small" className={listStyles.muted}>
        {t('settings.remoteAccess.macAlwaysAllowed')}
      </Text>

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

      {devices.length === 0 ? (
        <Blankslate data-testid="remote-access-empty">
          <Blankslate.Visual><DeviceMobileIcon size={32} /></Blankslate.Visual>
          <Blankslate.Heading>{t('settings.remoteAccess.emptyHeading')}</Blankslate.Heading>
          <Blankslate.Description>{t('settings.remoteAccess.emptyDescription')}</Blankslate.Description>
        </Blankslate>
      ) : (
        <ActionList data-testid="paired-devices-list" style={{ marginTop: 'var(--base-size-8)' }}>
          {devices.map((d) => (
            <ActionList.Item key={d.id} data-testid="paired-device-row" data-device-id={d.id}>
              <Text weight="semibold">{d.label}</Text>
              <ActionList.Description variant="block">
                {t('settings.remoteAccess.deviceMeta', {
                  created: formatTimestamp(d.createdAt),
                  lastSeen: formatTimestamp(d.lastSeenAt),
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
