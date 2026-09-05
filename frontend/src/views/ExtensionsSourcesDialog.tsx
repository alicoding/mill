import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Dialog, FormControl, IconButton, Stack, Text, TextInput } from '@primer/react'
import { SyncIcon, TrashIcon } from '@primer/octicons-react'
import { PluginService } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc'
import type { MarketplaceSource } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { findCommand, runCommand } from '../shared/commands'
import { appTranslate, messageFor } from '../shared/userError'
import listStyles from '../shared/ListCard.module.css'
import styles from './ExtensionsSection.module.css'

// Where Browse gets its offerings (docs/goals/0349): a list of
// marketplaces the user added, each one a repository or folder
// carrying a marketplace index. Adding one reads its index once, so a
// wrong address is refused here rather than silently listing nothing.
//
// Nothing on this dialog fetches on its own. Refresh is a button
// because every outbound request Mill makes is one somebody asked for.
export function ExtensionsSourcesDialog({ onClose, onChanged }: {
  onClose: () => void
  onChanged: () => void
}) {
  const { t } = useTranslation('views')
  const [sources, setSources] = useState<MarketplaceSource[] | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = () => {
    PluginService.ListMarketplaceSources().then((s) => setSources(s ?? [])).catch(() => setSources([]))
  }
  useEffect(load, [])

  const add = () => {
    setBusy(true)
    setError('')
    PluginService.AddMarketplaceSource(input)
      .then(() => {
        setInput('')
        load()
        onChanged()
      })
      .catch((err) => setError(messageFor(err, appTranslate)))
      .finally(() => setBusy(false))
  }

  const remove = (name: string) => {
    setBusy(true)
    setError('')
    PluginService.RemoveMarketplaceSource(name)
      .then(() => {
        load()
        onChanged()
      })
      .catch((err) => setError(messageFor(err, appTranslate)))
      .finally(() => setBusy(false))
  }

  const refresh = () => {
    const command = findCommand('extension.refreshSources')
    if (command) void runCommand(command.id)
    onChanged()
  }

  return (
    <Dialog title={t('extensions.sources.title')} onClose={onClose}>
      <Stack direction="vertical" gap="condensed" data-testid="extensions-sources-dialog">
        <Stack direction="horizontal" justify="space-between" align="center" gap="condensed">
          <Text as="p" size="small" className={listStyles.muted}>{t('extensions.sources.subtitle')}</Text>
          <Button size="small" leadingVisual={SyncIcon} onClick={refresh} data-testid="extensions-sources-refresh">
            {t('extensions.sources.refresh')}
          </Button>
        </Stack>

        {sources !== null && sources.length === 0 && (
          <Text as="p" size="small" className={listStyles.muted} data-testid="extensions-sources-empty">
            {t('extensions.sources.empty')}
          </Text>
        )}
        {sources !== null && sources.length > 0 && (
          <ul className={styles.plainList} aria-label={t('extensions.sources.title')}>
            {sources.map((source) => (
              <li key={source.name} className={styles.sourceRow} data-testid="extensions-source-row" data-source-name={source.name}>
                <Stack direction="vertical" gap="none">
                  <Text size="small" weight="semibold">{source.name}</Text>
                  <Text size="small" className={listStyles.muted}>{source.locator}</Text>
                </Stack>
                <IconButton
                  icon={TrashIcon}
                  variant="danger"
                  size="small"
                  aria-label={t('extensions.sources.removeAria', { name: source.name })}
                  disabled={busy}
                  onClick={() => remove(source.name)}
                  data-testid="extensions-source-remove"
                />
              </li>
            ))}
          </ul>
        )}

        <FormControl>
          <FormControl.Label>{t('extensions.sources.addLabel')}</FormControl.Label>
          <TextInput
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('extensions.sources.addPlaceholder')}
            data-testid="extensions-source-input"
            block
          />
          <FormControl.Caption>{t('extensions.sources.addCaption')}</FormControl.Caption>
        </FormControl>
        <Stack direction="horizontal" gap="condensed" align="center">
          <Button
            variant="primary"
            size="small"
            disabled={busy || input.trim() === ''}
            onClick={add}
            data-testid="extensions-source-add"
          >
            {t('extensions.sources.add')}
          </Button>
          {error && <Text size="small" data-testid="extensions-sources-error">{error}</Text>}
        </Stack>
      </Stack>
    </Dialog>
  )
}
