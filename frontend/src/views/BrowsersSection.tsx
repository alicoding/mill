import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, Button, IconButton, Label, Stack, Text } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import { BrowserIcon, CheckIcon, CopyIcon, PlusIcon } from '@primer/octicons-react'
import { useState } from 'react'
import type { DeviceInfo } from '../shared/bindings'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { formatUpdated } from '../shared/inventorySort'
import { writeClipboardText } from '../shared/clipboardWrite'
import { runCommand, findCommand } from '../shared/commands'
import { useBrowserBridgeStore, refreshBrowserBridge } from '../shared/browserBridgeStore'
import { background } from '../shared/background'
import listStyles from '../shared/ListCard.module.css'
import monoStyles from '../shared/monoText.module.css'

// Settings > Connections > Browsers: the address a browser extension is
// pointed at, the pairing code that authorises it, the browsers already
// paired, and one action that proves the whole channel end to end.
//
// Every browser here holds its own bearer token. A paired phone's
// credential is a different kind and never appears in this list.
function BrowsersSection() {
  const { t } = useTranslation('views')
  const status = useBrowserBridgeStore((s) => s.status)
  const browsers = useBrowserBridgeStore((s) => s.browsers)
  const pairing = useBrowserBridgeStore((s) => s.pairing)
  const test = useBrowserBridgeStore((s) => s.test)
  const testSteps = useBrowserBridgeStore((s) => s.testSteps)
  const testDurationMS = useBrowserBridgeStore((s) => s.testDurationMS)
  const error = useBrowserBridgeStore((s) => s.error)
  const revoke = useBrowserBridgeStore((s) => s.revoke)
  const [revoking, setRevoking] = useState<DeviceInfo | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => { void refreshBrowserBridge() }, [])

  const copyAddress = () => {
    if (!status?.address) return
    void background(writeClipboardText(status.address).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }), 'browsers.copyAddress')
  }

  const confirmRevoke = () => {
    if (!revoking) return
    const target = revoking
    setRevoking(null)
    void background(revoke(target.id), 'browsers.revoke')
  }

  // Never gate the section behind its fetch: a section that collapses
  // to zero height on first paint and pops in shifts every section
  // below it, which the deep-link scroll test pins.
  const list = browsers ?? []
  const testCommand = findCommand('browser.test')
  const canTest = testCommand ? (!testCommand.enabled || testCommand.enabled()) : false

  return (
    <>
      <Text as="p" size="small" className={listStyles.muted}>
        {t('settings.browsers.description')}
      </Text>
      <Text as="p" size="small" className={listStyles.muted}>
        {t('settings.browsers.install')}
      </Text>

      <Stack direction="vertical" gap="none" style={{ marginTop: 'var(--base-size-8)' }} data-testid="bridge-address-row">
        <Text as="p" size="small" weight="semibold">{t('settings.browsers.addressLabel')}</Text>
        <Stack direction="horizontal" gap="condensed" align="center">
          <Text size="small" className={monoStyles.mono} data-testid="bridge-address">
            {status?.address ?? ''}
          </Text>
          <IconButton
            icon={copied ? CheckIcon : CopyIcon}
            size="small"
            variant="invisible"
            aria-label={copied ? t('settings.browsers.addressCopiedAriaLabel') : t('settings.browsers.addressCopyAriaLabel')}
            onClick={copyAddress}
            data-testid="bridge-address-copy"
          />
        </Stack>
        <Text as="p" size="small" className={listStyles.muted}>
          {status?.envOverride ? t('settings.browsers.addressEnvCaption') : t('settings.browsers.addressCaption')}
        </Text>
      </Stack>

      <Stack direction="horizontal" gap="condensed" style={{ marginTop: 'var(--base-size-8)' }}>
        <Button
          size="small"
          leadingVisual={PlusIcon}
          onClick={() => { void runCommand('browser.pair') }}
          data-testid="pair-a-browser"
        >
          {t('settings.browsers.pairABrowser')}
        </Button>
        <Button
          size="small"
          disabled={!canTest}
          onClick={() => { void runCommand('browser.test') }}
          data-testid="test-browser-connection"
        >
          {test === 'running' ? t('settings.browsers.testing') : t('settings.browsers.test')}
        </Button>
      </Stack>

      {pairing && (
        <Stack direction="vertical" gap="condensed" style={{ marginTop: 'var(--base-size-8)' }} data-testid="browser-pairing-code-panel">
          <Text size="large" weight="semibold" className={monoStyles.mono} data-testid="browser-pairing-code">
            {pairing.code}
          </Text>
          <Text as="p" size="small" className={listStyles.muted}>
            {t('settings.browsers.codeExpiry')}
          </Text>
        </Stack>
      )}

      {test === 'passed' && (
        <Text as="p" size="small" style={{ marginTop: 'var(--base-size-8)' }} data-testid="browser-test-result">
          {t('settings.browsers.testPassed', { steps: testSteps, ms: testDurationMS })}
        </Text>
      )}

      {list.length === 0 ? (
        <Blankslate data-testid="browsers-empty">
          <Blankslate.Visual><BrowserIcon size={32} /></Blankslate.Visual>
          <Blankslate.Heading>{t('settings.browsers.emptyHeading')}</Blankslate.Heading>
          <Blankslate.Description>{t('settings.browsers.emptyDescription')}</Blankslate.Description>
        </Blankslate>
      ) : (
        <ActionList data-testid="paired-browsers-list" style={{ marginTop: 'var(--base-size-8)' }}>
          {list.map((b) => (
            <ActionList.Item key={b.id} data-testid="paired-browser-row" data-browser-id={b.id}>
              <Stack direction="horizontal" gap="condensed" align="center">
                <Text weight="semibold">{b.label}</Text>
                <Label variant={status?.connected ? 'success' : 'secondary'} data-testid="browser-connection-state">
                  {status?.connected ? t('settings.browsers.connected') : t('settings.browsers.waiting')}
                </Label>
              </Stack>
              <ActionList.Description variant="block">
                {t('settings.browsers.browserMeta', {
                  created: formatUpdated(b.createdAt),
                  lastSeen: formatUpdated(b.lastSeenAt),
                })}
              </ActionList.Description>
              <ActionList.TrailingVisual>
                <div style={{ pointerEvents: 'auto' }} onClick={(e) => e.stopPropagation()}>
                  <Button size="small" variant="danger" onClick={() => setRevoking(b)} data-testid="revoke-browser">
                    {t('settings.browsers.revoke')}
                  </Button>
                </div>
              </ActionList.TrailingVisual>
            </ActionList.Item>
          ))}
        </ActionList>
      )}

      {error && (
        <Text as="p" size="small" className={listStyles.error} style={{ marginTop: 'var(--base-size-8)' }} data-testid="browser-bridge-error">
          {error}
        </Text>
      )}

      {revoking && (
        <ConfirmDialog
          title={t('settings.browsers.revokeConfirmTitle', { label: revoking.label })}
          body={t('settings.browsers.revokeConfirmBody', { label: revoking.label })}
          confirmLabel={t('settings.browsers.revoke')}
          onCancel={() => setRevoking(null)}
          onConfirm={confirmRevoke}
        />
      )}
    </>
  )
}

export default BrowsersSection
