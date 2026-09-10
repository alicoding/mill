import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, Button, Dialog, FormControl, Spinner, Stack, Text, TextInput } from '@primer/react'
import { SyncIcon, TrashIcon } from '@primer/octicons-react'
import type { MarketplaceSource } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { findCommand, runCommand } from '../shared/commands'
import type { CommandContext } from '../shared/commandContext'
import { entityRowContext } from '../shared/entityRowCommands'
import { MARKETPLACE_SOURCE_ENTITY } from '../shared/extensionsCommands'
import { useExtensionSourcesStore } from '../shared/extensionSourcesStore'
import { usePluginPolicy } from '../shared/pluginPolicyStore'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { formatUpdated } from '../shared/inventorySort'
import { appTranslate, messageFor } from '../shared/userError'
import { pushNotice } from '../shared/noticeStore'
import listStyles from '../shared/ListCard.module.css'

// Sources are local catalog state. Only explicit Add and Refresh commands may
// reach the network; opening, retrying, and completion reads stay local.
export function ExtensionsSourcesDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('views')
  const sources = useExtensionSourcesStore((state) => state.sources)
  const ready = useExtensionSourcesStore((state) => state.ready)
  const loading = useExtensionSourcesStore((state) => state.loading)
  const error = useExtensionSourcesStore((state) => state.error)
  const mutation = useExtensionSourcesStore((state) => state.mutation)
  const completionRevision = useExtensionSourcesStore((state) => state.completionRevision)
  const load = useExtensionSourcesStore((state) => state.load)
  const confirmRemoval = useExtensionSourcesStore((state) => state.confirmRemoval)
  const clearRemoval = useExtensionSourcesStore((state) => state.clearRemoval)
  const [input, setInput] = useState('')
  const [pendingRemove, setPendingRemove] = useState<MarketplaceSource | null>(null)
  usePluginPolicy()

  useEffect(() => {
    void load()
  }, [completionRevision, load])

  const add = async () => {
    const submitted = input
    const context: CommandContext = { kind: 'marketplaceSourceInput', locator: submitted }
    if (await runCommand('extension.addSource', context)) {
      setInput((current) => current === submitted ? '' : current)
    }
  }

  const askToRemove = (source: MarketplaceSource) => {
    confirmRemoval(source.incarnation)
    setPendingRemove(source)
  }

  const cancelRemove = () => {
    clearRemoval()
    setPendingRemove(null)
  }

  const remove = async () => {
    if (!pendingRemove) return
    const context = entityRowContext(MARKETPLACE_SOURCE_ENTITY, pendingRemove.name)
    const current = useExtensionSourcesStore.getState().sources.find((source) => source.name === pendingRemove.name)
    if (!current || current.incarnation !== pendingRemove.incarnation) {
      pushNotice({ level: 'error', text: t('extensions.sources.identityChanged') })
      return
    }
    if (await runCommand('extension.source.remove', context)) {
      setPendingRemove(null)
      clearRemoval()
    }
  }

  const removeContext = pendingRemove
    ? entityRowContext(MARKETPLACE_SOURCE_ENTITY, pendingRemove.name)
    : undefined
  const removeCommand = findCommand('extension.source.remove')
  const addContext: CommandContext = { kind: 'marketplaceSourceInput', locator: input }
  const addCommand = findCommand('extension.addSource')
  const addEnabled = addCommand !== undefined && (addCommand.enabled?.(addContext) ?? true)
  const removeConfirm = removeContext ? removeCommand?.confirm?.(removeContext) : null

  return (
    <>
      <Dialog title={t('extensions.sources.title')} onClose={onClose}>
        <Stack direction="vertical" gap="condensed" data-testid="extensions-sources-dialog">
          <Stack direction="horizontal" justify="space-between" align="center" gap="condensed">
            <Text as="p" size="small" className={listStyles.muted}>{t('extensions.sources.subtitle')}</Text>
            <Button
              size="small"
              leadingVisual={SyncIcon}
              disabled={mutation !== null || !ready}
              onClick={() => { void runCommand('extension.refreshSources') }}
              data-testid="extensions-sources-refresh"
            >
              {t('extensions.sources.refresh')}
            </Button>
          </Stack>

          {loading && !ready && (
            <Stack direction="horizontal" gap="condensed" align="center" data-testid="extensions-sources-loading">
              <Spinner size="small" />
              <Text size="small">{t('extensions.sources.loading')}</Text>
            </Stack>
          )}
          {!loading && !ready && error && (
            <Stack direction="vertical" gap="condensed" data-testid="extensions-sources-read-error">
              <Text size="small" className={listStyles.error}>{t('extensions.sources.readError')}</Text>
              <Text size="small" className={listStyles.muted}>{messageFor(error, appTranslate)}</Text>
              <div>
                <Button size="small" onClick={() => { void load() }}>{t('extensions.sources.retry')}</Button>
              </div>
            </Stack>
          )}
          {ready && sources.length === 0 && (
            <Text as="p" size="small" className={listStyles.muted} data-testid="extensions-sources-empty">
              {t('extensions.sources.empty')}
            </Text>
          )}
          {sources.length > 0 && (
            <ActionList role="list" aria-label={t('extensions.sources.title')} data-testid="extensions-sources-list">
              {sources.map((source) => {
                const refreshed = source.lastSuccessAt ? formatUpdated(source.lastSuccessAt) : ''
                const refreshLabel = source.lastSuccessAt
                  ? (refreshed ? t('extensions.sources.lastRefreshed', { time: refreshed }) : t('extensions.sources.refreshTimeUnknown'))
                  : (source.status === 'never-fetched' ? t('extensions.sources.neverRefreshed') : t('extensions.sources.refreshTimeUnknown'))
                const reason = source.errorDetail || (source.errorCode === 'source-identity-changed' ? t('extensions.sources.identityChanged') : '')
                return (
                  <ActionList.Item key={`${source.name}/${source.incarnation}`} data-testid="extensions-source-row" data-source-name={source.name}>
                    <Text weight="semibold">{source.name}</Text>
                    <ActionList.Description variant="block">
                      <Text as="p" size="small" style={{ margin: 0 }}>
                        {source.included ? t('extensions.sources.included') : [source.owner, source.locator].filter(Boolean).join(' · ')}
                      </Text>
                      <Text as="p" size="small" style={{ margin: 0 }}>{refreshLabel}</Text>
                      {reason && <Text as="p" size="small" style={{ margin: 0 }}>{reason}</Text>}
                    </ActionList.Description>
                    {!source.included && (
                      <ActionList.TrailingAction
                        as="button"
                        icon={TrashIcon}
                        label={t('extensions.sources.removeAria', { name: source.name })}
                        aria-disabled={mutation !== null || !ready}
                        onClick={(event: React.MouseEvent) => {
                          event.stopPropagation()
                          if (mutation === null && ready) askToRemove(source)
                        }}
                      />
                    )}
                  </ActionList.Item>
                )
              })}
            </ActionList>
          )}

          <form onSubmit={(event) => { event.preventDefault(); void add() }}>
            <Stack direction="vertical" gap="condensed">
              <FormControl>
                <FormControl.Label>{t('extensions.sources.addLabel')}</FormControl.Label>
                <TextInput
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder={t('extensions.sources.addPlaceholder')}
                  data-testid="extensions-source-input"
                  block
                />
                <FormControl.Caption>{t('extensions.sources.addCaption')}</FormControl.Caption>
              </FormControl>
              <div>
                <Button
                  type="submit"
                  variant="primary"
                  size="small"
                  disabled={!addEnabled}
                  data-testid="extensions-source-add"
                >
                  {t('extensions.sources.add')}
                </Button>
              </div>
            </Stack>
          </form>
        </Stack>
      </Dialog>
      {pendingRemove && removeConfirm && (
        <ConfirmDialog
          title={removeConfirm.title}
          body={removeConfirm.body}
          confirmLabel={removeConfirm.confirmLabel}
          onCancel={cancelRemove}
          onConfirm={() => { void remove() }}
        />
      )}
    </>
  )
}
