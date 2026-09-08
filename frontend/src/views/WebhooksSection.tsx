import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, Button, IconButton, Stack, Text, TextInput, Link } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import { CheckIcon, CopyIcon, KeyIcon, PlusIcon, XIcon } from '@primer/octicons-react'
import type { DeviceInfo } from '../shared/bindings'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { formatUpdated } from '../shared/inventorySort'
import { runCommand } from '../shared/commands'
import { useWebhookTokensStore, refreshWebhookTokens } from '../shared/webhookTokensStore'
import { useAppStore } from '../shared/store'
import { background } from '../shared/background'
import listStyles from '../shared/ListCard.module.css'
import monoStyles from '../shared/monoText.module.css'

// The one how-to page for posting to the door this section mints
// credentials for.
const WEBHOOK_DOCS_PAGE = 'how-to/webhooks.md'

// Settings > Connections > Webhooks: every webhook token minted so
// far, the one mint action, and the ONCE-shown token panel. A webhook
// token is the same credential kind Settings pairs elsewhere (a
// label, a created stamp, a revoke), just minted headless -- the
// consumer is a shell command or an HTTP client in a tool's own
// configuration, so the pairing ceremony is copying the token at mint
// time. Mint/label/token state lives in webhookTokensStore, not local
// state, since the registered webhook.mint command (goal 0222) needs
// the same truth this section renders.
function WebhooksSection() {
  const { t } = useTranslation('views')
  const tokens = useWebhookTokensStore((s) => s.tokens)
  const minting = useWebhookTokensStore((s) => s.minting)
  const labelDraft = useWebhookTokensStore((s) => s.labelDraft)
  const fresh = useWebhookTokensStore((s) => s.fresh)
  const copied = useWebhookTokensStore((s) => s.copied)
  const error = useWebhookTokensStore((s) => s.error)
  const setLabelDraft = useWebhookTokensStore((s) => s.setLabelDraft)
  const cancelMint = useWebhookTokensStore((s) => s.cancelMint)
  const [revoking, setRevoking] = useState<DeviceInfo | null>(null)

  useEffect(() => { void refreshWebhookTokens() }, [])

  const confirmMint = () => {
    void background(useWebhookTokensStore.getState().confirmMint(), 'webhooks.mint')
  }

  const copyFreshToken = () => {
    void background(useWebhookTokensStore.getState().copyFreshToken(), 'webhooks.copyToken')
  }

  const confirmRevoke = () => {
    if (!revoking) return
    const target = revoking
    setRevoking(null)
    void background(useWebhookTokensStore.getState().revoke(target.id), 'webhooks.revoke')
  }

  // Never gate the whole section behind the ListWebhookTokens() fetch
  // -- the same zero-height-collapse reasoning RemoteAccessSection's
  // own comment records for this pane.
  const list = tokens ?? []

  return (
    <>
      <Text as="p" size="small" className={listStyles.muted}>
        {t('settings.webhooks.description')}
      </Text>
      <Link
        href="#"
        data-testid="webhook-docs-link"
        onClick={(e) => {
          e.preventDefault()
          useAppStore.getState().setView({ kind: 'docs', page: WEBHOOK_DOCS_PAGE })
        }}
      >
        <Text size="small">{t('settings.webhooks.docsLink')}</Text>
      </Link>

      {minting ? (
        <Stack direction="vertical" gap="condensed" style={{ marginTop: 'var(--base-size-8)' }}>
          <Text as="p" size="small" className={listStyles.muted}>
            {t('settings.webhooks.mintLabelCaption')}
          </Text>
          <Stack direction="horizontal" gap="condensed" align="center">
            <TextInput
              size="small"
              autoFocus
              value={labelDraft}
              placeholder={t('settings.webhooks.mintLabelPlaceholder')}
              onChange={(e) => setLabelDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmMint()
                if (e.key === 'Escape') cancelMint()
              }}
              aria-label={t('settings.webhooks.mintLabelAriaLabel')}
              data-testid="webhook-label-input"
            />
            <Button size="small" variant="primary" onClick={confirmMint} data-testid="webhook-mint-confirm">
              {t('settings.webhooks.mint')}
            </Button>
            <IconButton
              icon={XIcon}
              size="small"
              variant="invisible"
              aria-label={t('settings.webhooks.mintCancelAriaLabel')}
              onClick={cancelMint}
              data-testid="webhook-mint-cancel"
            />
          </Stack>
        </Stack>
      ) : (
        <Button
          size="small"
          leadingVisual={PlusIcon}
          onClick={() => { void runCommand('webhook.mint') }}
          style={{ marginTop: 'var(--base-size-8)' }}
          data-testid="mint-a-webhook-token"
        >
          {t('settings.webhooks.mintAToken')}
        </Button>
      )}

      {fresh && (
        <Stack direction="vertical" gap="none" style={{ marginTop: 'var(--base-size-8)' }} data-testid="webhook-token-panel">
          <Stack direction="horizontal" gap="condensed" align="center">
            <Text size="small" className={monoStyles.mono} data-testid="webhook-token-value">
              {fresh.token}
            </Text>
            <IconButton
              icon={copied ? CheckIcon : CopyIcon}
              size="small"
              variant="invisible"
              aria-label={copied ? t('settings.webhooks.tokenCopiedAriaLabel') : t('settings.webhooks.tokenCopyAriaLabel')}
              onClick={copyFreshToken}
              data-testid="webhook-token-copy"
            />
          </Stack>
          <Text as="p" size="small" className={listStyles.muted}>
            {t('settings.webhooks.tokenShownOnce')}
          </Text>
        </Stack>
      )}

      {list.length === 0 ? (
        <Blankslate data-testid="webhooks-empty">
          <Blankslate.Visual><KeyIcon size={32} /></Blankslate.Visual>
          <Blankslate.Heading>{t('settings.webhooks.emptyHeading')}</Blankslate.Heading>
          <Blankslate.Description>{t('settings.webhooks.emptyDescription')}</Blankslate.Description>
        </Blankslate>
      ) : (
        <ActionList data-testid="webhook-tokens-list" style={{ marginTop: 'var(--base-size-8)' }}>
          {list.map((token) => (
            <ActionList.Item key={token.id} data-testid="webhook-token-row" data-webhook-id={token.id}>
              <Text weight="semibold">{token.label}</Text>
              <ActionList.Description variant="block">
                {t('settings.webhooks.tokenMeta', { created: formatUpdated(token.createdAt) })}
              </ActionList.Description>
              <ActionList.TrailingVisual>
                <div style={{ pointerEvents: 'auto' }} onClick={(e) => e.stopPropagation()}>
                  <Button size="small" variant="danger" onClick={() => setRevoking(token)} data-testid="revoke-webhook-token">
                    {t('settings.webhooks.revoke')}
                  </Button>
                </div>
              </ActionList.TrailingVisual>
            </ActionList.Item>
          ))}
        </ActionList>
      )}

      {error && (
        <Text as="p" size="small" className={listStyles.error} style={{ marginTop: 'var(--base-size-8)' }} data-testid="webhooks-section-error">
          {error}
        </Text>
      )}

      {revoking && (
        <ConfirmDialog
          title={t('settings.webhooks.revokeConfirmTitle', { label: revoking.label })}
          body={t('settings.webhooks.revokeConfirmBody', { label: revoking.label })}
          confirmLabel={t('settings.webhooks.revoke')}
          onCancel={() => setRevoking(null)}
          onConfirm={confirmRevoke}
        />
      )}
    </>
  )
}

export default WebhooksSection
