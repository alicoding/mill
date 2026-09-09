import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, Button, Label, Link, Stack, Text } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import { BrowserIcon, CheckIcon, CopyIcon, FileDirectoryIcon, PlusIcon } from '@primer/octicons-react'
import { useState } from 'react'
import type { DeviceInfo } from '../shared/bindings'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { formatUpdated } from '../shared/inventorySort'
import { writeClipboardText } from '../shared/clipboardWrite'
import { runCommand, findCommand } from '../shared/commands'
import { useBrowserBridgeStore, refreshBrowserBridge } from '../shared/browserBridgeStore'
import { PAIRING_POLL_MS, gainedMember, usePairingCountdown, formatCountdown } from '../shared/pairingCountdown'
import { background } from '../shared/background'
import { useAppStore } from '../shared/store'
import { useUISignalStore } from '../shared/uiSignalStore'
import listStyles from '../shared/ListCard.module.css'
import monoStyles from '../shared/monoText.module.css'

// The one page explaining how to load and pair the extension: the
// docs route addresses pages, and this section's copy names the action
// rather than restating the page.
const BROWSER_EXTENSION_DOCS_PAGE = 'reference/browser-extension.md'

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
  const extensionPath = useBrowserBridgeStore((s) => s.extensionPath)
  const testSteps = useBrowserBridgeStore((s) => s.testSteps)
  const testDurationMS = useBrowserBridgeStore((s) => s.testDurationMS)
  const pairingBaselineCount = useBrowserBridgeStore((s) => s.pairingBaselineCount)
  const clearPairing = useBrowserBridgeStore((s) => s.clearPairing)
  const incomingRequest = useBrowserBridgeStore((s) => s.incomingRequest)
  const error = useBrowserBridgeStore((s) => s.error)
  const revoke = useBrowserBridgeStore((s) => s.revoke)
  const [revoking, setRevoking] = useState<DeviceInfo | null>(null)
  const [copied, setCopied] = useState(false)
  const [codeCopied, setCodeCopied] = useState(false)
  const [requestCodeCopied, setRequestCodeCopied] = useState(false)
  const acceptButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => { void refreshBrowserBridge() }, [])

  // Never gate the section behind its fetch: a section that collapses
  // to zero height on first paint and pops in shifts every section
  // below it, which the deep-link scroll test pins.
  const list = browsers ?? []

  const remainingMS = usePairingCountdown(pairing?.expiresAt)
  const requestRemainingMS = usePairingCountdown(incomingRequest?.expiresAt)

  // The card clears itself once the server's own TTL elapses -- a dead
  // code must never keep showing as if it still worked.
  useEffect(() => {
    if (pairing && remainingMS <= 0) clearPairing()
  }, [pairing, remainingMS, clearPairing])

  // The card also clears the instant this browser's own pairing
  // succeeds, read from the same poll below.
  useEffect(() => {
    if (pairing && gainedMember(pairingBaselineCount, list.length)) clearPairing()
  }, [pairing, pairingBaselineCount, list.length, clearPairing])

  // Mill has no server push for "a browser just paired" or "a browser
  // wants to pair" -- poll on the same cadence the countdown ticks for
  // as long as this section is mounted, unconditionally: an incoming
  // request can appear with no local action to trigger a re-fetch (a
  // popup's own "Pair with Mill" click, on a different process), so
  // gating this on an already-known pairing/request would never notice
  // a brand new one. A live code or request resolving (a completed
  // pairing, an expired request) also clears its own card via this
  // same poll.
  useEffect(() => {
    const id = setInterval(() => { void refreshBrowserBridge() }, PAIRING_POLL_MS)
    return () => clearInterval(id)
  }, [])

  // The desktop banner's click lands here with the request card not
  // necessarily built yet (a fresh navigation can mount this section
  // after the signal was already set) -- move focus once BOTH the
  // signal and the card's own data have arrived, then consume it so a
  // later, unrelated visit never replays it.
  const browserPairRequestFocus = useUISignalStore((s) => s.browserPairRequestFocus)
  const consumeBrowserPairRequestFocus = useUISignalStore((s) => s.consumeBrowserPairRequestFocus)
  useEffect(() => {
    if (!browserPairRequestFocus || !incomingRequest) return
    acceptButtonRef.current?.focus()
    consumeBrowserPairRequestFocus()
  }, [browserPairRequestFocus, incomingRequest, consumeBrowserPairRequestFocus])

  const copyAddress = () => {
    if (!status?.address) return
    void background(writeClipboardText(status.address).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }), 'browsers.copyAddress')
  }

  const copyCode = () => {
    if (!pairing) return
    void background(writeClipboardText(pairing.code).then(() => {
      setCodeCopied(true)
      setTimeout(() => setCodeCopied(false), 1500)
    }), 'browsers.copyCode')
  }

  const copyRequestCode = () => {
    if (!incomingRequest) return
    void background(writeClipboardText(incomingRequest.code).then(() => {
      setRequestCodeCopied(true)
      setTimeout(() => setRequestCodeCopied(false), 1500)
    }), 'browsers.copyRequestCode')
  }

  const confirmRevoke = () => {
    if (!revoking) return
    const target = revoking
    setRevoking(null)
    void background(revoke(target.id), 'browsers.revoke')
  }

  const testCommand = findCommand('browser.test')
  const canTest = testCommand ? (!testCommand.enabled || testCommand.enabled()) : false
  const acceptCommand = findCommand('browser.pairRequest.accept')
  const canAccept = acceptCommand ? (!acceptCommand.enabled || acceptCommand.enabled()) : false
  const denyCommand = findCommand('browser.pairRequest.deny')
  const canDeny = denyCommand ? (!denyCommand.enabled || denyCommand.enabled()) : false

  return (
    <>
      <Text as="p" size="small" className={listStyles.muted}>
        {t('settings.browsers.description')}
      </Text>
      <Text as="p" size="small" className={listStyles.muted}>
        {t('settings.browsers.install')}
      </Text>
      <Stack direction="horizontal" gap="condensed" align="center" style={{ marginTop: 'var(--base-size-4)' }}>
        <Button
          size="small"
          leadingVisual={FileDirectoryIcon}
          onClick={() => { void runCommand('browser.revealExtension') }}
          data-testid="reveal-extension-folder"
        >
          {t('settings.browsers.revealExtension')}
        </Button>
        <Link
          href="#"
          data-testid="browser-extension-docs-link"
          onClick={(e) => {
            e.preventDefault()
            useAppStore.getState().setView({ kind: 'docs', page: BROWSER_EXTENSION_DOCS_PAGE })
          }}
        >
          <Text size="small">{t('settings.browsers.extensionDocsLink')}</Text>
        </Link>
      </Stack>
      {extensionPath && (
        <Stack direction="vertical" gap="none" style={{ marginTop: 'var(--base-size-4)' }}>
          <Text size="small" className={monoStyles.mono} data-testid="extension-folder-path">{extensionPath}</Text>
          <Text as="p" size="small" className={listStyles.muted}>{t('settings.browsers.extensionPathCaption')}</Text>
        </Stack>
      )}

      <Stack direction="vertical" gap="none" style={{ marginTop: 'var(--base-size-8)' }} data-testid="bridge-address-row">
        <Text as="p" size="small" weight="semibold">{t('settings.browsers.addressLabel')}</Text>
        <Stack direction="horizontal" gap="condensed" align="center">
          <Text size="small" className={monoStyles.mono} data-testid="bridge-address">
            {status?.address ?? ''}
          </Text>
          <Button
            size="small"
            leadingVisual={copied ? CheckIcon : CopyIcon}
            onClick={copyAddress}
            data-testid="bridge-address-copy"
          >
            {copied ? t('settings.browsers.addressCopiedButton') : t('settings.browsers.addressCopyButton')}
          </Button>
        </Stack>
        <Text as="p" size="small" className={listStyles.muted}>
          {status?.envOverride ? t('settings.browsers.addressEnvCaption') : t('settings.browsers.addressCaption')}
        </Text>
        <Text as="p" size="small" className={listStyles.muted}>
          {t('settings.browsers.addressBrowserFallback')}
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

      {incomingRequest && (
        <Stack direction="vertical" gap="condensed" style={{ marginTop: 'var(--base-size-8)' }} data-testid="browser-pair-request-card">
          <Text as="p" weight="semibold" data-testid="browser-pair-request-title">
            {t('settings.browsers.pairRequestTitle', { label: incomingRequest.label })}
          </Text>
          <Stack direction="horizontal" gap="condensed" align="center">
            <Text size="large" weight="semibold" className={monoStyles.mono} data-testid="browser-pair-request-code">
              {incomingRequest.code}
            </Text>
            <Button
              size="small"
              leadingVisual={requestCodeCopied ? CheckIcon : CopyIcon}
              onClick={copyRequestCode}
              data-testid="browser-pair-request-code-copy"
            >
              {requestCodeCopied ? t('settings.browsers.codeCopiedButton') : t('settings.browsers.codeCopyButton')}
            </Button>
          </Stack>
          <Text as="p" size="small" className={listStyles.muted}>
            {t('settings.browsers.pairRequestCaption')}
          </Text>
          <Text as="p" size="small" className={listStyles.muted} data-testid="browser-pair-request-countdown">
            {t('settings.browsers.codeCountdown', { time: formatCountdown(requestRemainingMS) })}
          </Text>
          <Stack direction="horizontal" gap="condensed">
            <Button
              ref={acceptButtonRef}
              size="small"
              variant="primary"
              disabled={!canAccept}
              onClick={() => { void runCommand('browser.pairRequest.accept') }}
              data-testid="browser-pair-request-accept"
            >
              {t('settings.browsers.pairRequestAccept')}
            </Button>
            <Button
              size="small"
              variant="danger"
              disabled={!canDeny}
              onClick={() => { void runCommand('browser.pairRequest.deny') }}
              data-testid="browser-pair-request-deny"
            >
              {t('settings.browsers.pairRequestDeny')}
            </Button>
          </Stack>
        </Stack>
      )}

      {pairing && (
        <Stack direction="vertical" gap="condensed" style={{ marginTop: 'var(--base-size-8)' }} data-testid="browser-pairing-code-panel">
          <Stack direction="horizontal" gap="condensed" align="center">
            <Text size="large" weight="semibold" className={monoStyles.mono} data-testid="browser-pairing-code">
              {pairing.code}
            </Text>
            <Button
              size="small"
              leadingVisual={codeCopied ? CheckIcon : CopyIcon}
              onClick={copyCode}
              data-testid="browser-pairing-code-copy"
            >
              {codeCopied ? t('settings.browsers.codeCopiedButton') : t('settings.browsers.codeCopyButton')}
            </Button>
          </Stack>
          <Text as="p" size="small" className={listStyles.muted}>
            {t('settings.browsers.codeExpiry')}
          </Text>
          <Text as="p" size="small" className={listStyles.muted} data-testid="browser-pairing-code-countdown">
            {t('settings.browsers.codeCountdown', { time: formatCountdown(remainingMS) })}
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
                <Text as="p" size="small" style={{ margin: 0 }}>
                  {t('settings.browsers.browserMeta', {
                    created: formatUpdated(b.createdAt),
                    lastSeen: formatUpdated(b.lastSeenAt),
                  })}
                </Text>
                {!status?.connected && (
                  <Text as="p" size="small" style={{ margin: 0 }} data-testid="browser-reconnect-hint">
                    {t('settings.browsers.reconnectHint')}
                  </Text>
                )}
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
