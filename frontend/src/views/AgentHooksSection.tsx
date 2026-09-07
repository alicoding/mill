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

// The one recipe page for wiring a tool's hook config up to the door
// this section mints credentials for.
const HOOK_RECIPE_DOCS_PAGE = 'agents/agent-hooks.md'

// Settings > Connections > Webhooks: every hook token minted so far,
// the one mint action, and the ONCE-shown token panel. A hook token is
// the same credential kind Settings pairs elsewhere (a label, a created
// stamp, a revoke), just minted headless -- the consumer is a shell
// command in a tool's config file, so the pairing ceremony is copying
// the token at mint time. Mint/label/token state lives in
// webhookTokensStore, not local state, since the registered
// webhook.mint command (goal 0222) needs the same truth this section
// renders.
function AgentHooksSection() {
  const { t } = useTranslation('views')
  const hooks = useWebhookTokensStore((s) => s.hooks)
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
    void background(useWebhookTokensStore.getState().confirmMint(), 'agentHooks.mint')
  }

  const copyFreshToken = () => {
    void background(useWebhookTokensStore.getState().copyFreshToken(), 'agentHooks.copyToken')
  }

  const confirmRevoke = () => {
    if (!revoking) return
    const target = revoking
    setRevoking(null)
    void background(useWebhookTokensStore.getState().revoke(target.id), 'agentHooks.revoke')
  }

  // Never gate the whole section behind the ListHooks() fetch -- the
  // same zero-height-collapse reasoning RemoteAccessSection's own
  // comment records for this pane.
  const list = hooks ?? []

  return (
    <>
      <Text as="p" size="small" className={listStyles.muted}>
        {t('settings.hooks.description')}
      </Text>
      <Link
        href="#"
        data-testid="hook-recipe-docs-link"
        onClick={(e) => {
          e.preventDefault()
          useAppStore.getState().setView({ kind: 'docs', page: HOOK_RECIPE_DOCS_PAGE })
        }}
      >
        <Text size="small">{t('settings.hooks.docsLink')}</Text>
      </Link>

      {minting ? (
        <Stack direction="vertical" gap="condensed" style={{ marginTop: 'var(--base-size-8)' }}>
          <Text as="p" size="small" className={listStyles.muted}>
            {t('settings.hooks.mintLabelCaption')}
          </Text>
          <Stack direction="horizontal" gap="condensed" align="center">
            <TextInput
              size="small"
              autoFocus
              value={labelDraft}
              placeholder={t('settings.hooks.mintLabelPlaceholder')}
              onChange={(e) => setLabelDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmMint()
                if (e.key === 'Escape') cancelMint()
              }}
              aria-label={t('settings.hooks.mintLabelAriaLabel')}
              data-testid="hook-label-input"
            />
            <Button size="small" variant="primary" onClick={confirmMint} data-testid="hook-mint-confirm">
              {t('settings.hooks.mint')}
            </Button>
            <IconButton
              icon={XIcon}
              size="small"
              variant="invisible"
              aria-label={t('settings.hooks.mintCancelAriaLabel')}
              onClick={cancelMint}
              data-testid="hook-mint-cancel"
            />
          </Stack>
        </Stack>
      ) : (
        <Button
          size="small"
          leadingVisual={PlusIcon}
          onClick={() => { void runCommand('webhook.mint') }}
          style={{ marginTop: 'var(--base-size-8)' }}
          data-testid="mint-a-hook-token"
        >
          {t('settings.hooks.mintAToken')}
        </Button>
      )}

      {fresh && (
        <Stack direction="vertical" gap="none" style={{ marginTop: 'var(--base-size-8)' }} data-testid="hook-token-panel">
          <Stack direction="horizontal" gap="condensed" align="center">
            <Text size="small" className={monoStyles.mono} data-testid="hook-token-value">
              {fresh.token}
            </Text>
            <IconButton
              icon={copied ? CheckIcon : CopyIcon}
              size="small"
              variant="invisible"
              aria-label={copied ? t('settings.hooks.tokenCopiedAriaLabel') : t('settings.hooks.tokenCopyAriaLabel')}
              onClick={copyFreshToken}
              data-testid="hook-token-copy"
            />
          </Stack>
          <Text as="p" size="small" className={listStyles.muted}>
            {t('settings.hooks.tokenShownOnce')}
          </Text>
        </Stack>
      )}

      {list.length === 0 ? (
        <Blankslate data-testid="hooks-empty">
          <Blankslate.Visual><KeyIcon size={32} /></Blankslate.Visual>
          <Blankslate.Heading>{t('settings.hooks.emptyHeading')}</Blankslate.Heading>
          <Blankslate.Description>{t('settings.hooks.emptyDescription')}</Blankslate.Description>
        </Blankslate>
      ) : (
        <ActionList data-testid="hook-tokens-list" style={{ marginTop: 'var(--base-size-8)' }}>
          {list.map((h) => (
            <ActionList.Item key={h.id} data-testid="hook-token-row" data-hook-id={h.id}>
              <Text weight="semibold">{h.label}</Text>
              <ActionList.Description variant="block">
                {t('settings.hooks.tokenMeta', { created: formatUpdated(h.createdAt) })}
              </ActionList.Description>
              <ActionList.TrailingVisual>
                <div style={{ pointerEvents: 'auto' }} onClick={(e) => e.stopPropagation()}>
                  <Button size="small" variant="danger" onClick={() => setRevoking(h)} data-testid="revoke-hook-token">
                    {t('settings.hooks.revoke')}
                  </Button>
                </div>
              </ActionList.TrailingVisual>
            </ActionList.Item>
          ))}
        </ActionList>
      )}

      {error && (
        <Text as="p" size="small" className={listStyles.error} style={{ marginTop: 'var(--base-size-8)' }} data-testid="hooks-section-error">
          {error}
        </Text>
      )}

      {revoking && (
        <ConfirmDialog
          title={t('settings.hooks.revokeConfirmTitle', { label: revoking.label })}
          body={t('settings.hooks.revokeConfirmBody', { label: revoking.label })}
          confirmLabel={t('settings.hooks.revoke')}
          onCancel={() => setRevoking(null)}
          onConfirm={confirmRevoke}
        />
      )}
    </>
  )
}

export default AgentHooksSection
