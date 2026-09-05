import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Label, Stack, Text } from '@primer/react'
import { PackageIcon } from '@primer/octicons-react'
import { findCommand, runCommand } from '../shared/commands'
import type { CommandContext } from '../shared/commandContext'
import { EXTENSION_ENTITY } from '../shared/extensionsCommands'
import { refreshUpdates, useExtensionUpdatesStore } from '../shared/extensionUpdatesStore'
import { tierLabelKey, tierVariant } from './extensionTrust'
import listStyles from '../shared/ListCard.module.css'
import styles from './ExtensionsSection.module.css'

// Updates (docs/goals/0349 S5). Mill never checks on its own: an
// extension update is found because someone pressed Check for
// updates, the same rule every other outbound request here follows.
// The tab reads the LAST check's record; it fetches nothing on open.
//
// Three states: no check has ever run, the last check found nothing,
// and the list of candidates -- each row an Update that runs the same
// install door and the same acknowledgment the first install took.
export function ExtensionsUpdatesTab() {
  const { t } = useTranslation('views')
  const { loaded, checking, checkedAt, candidates, problems } = useExtensionUpdatesStore()

  useEffect(() => { void refreshUpdates() }, [])

  const checkCommand = findCommand('extensions.checkUpdates')
  const updateAllCommand = findCommand('extensions.updateAll')
  const canUpdateAll = updateAllCommand !== undefined && (updateAllCommand.enabled?.() ?? true)

  return (
    <Stack direction="vertical" gap="condensed" data-testid="extensions-updates">
      <Stack direction="horizontal" justify="space-between" align="center" gap="condensed">
        <Text as="p" size="small" className={listStyles.muted}>{t('extensions.updates.subtitle')}</Text>
        <Stack direction="horizontal" gap="condensed">
          {canUpdateAll && (
            <Button size="small" onClick={() => { void runCommand('extensions.updateAll') }} data-testid="extensions-update-all">
              {t('extensions.updates.updateAll')}
            </Button>
          )}
          <Button
            size="small"
            variant="primary"
            disabled={checking || checkCommand === undefined}
            onClick={() => { void runCommand('extensions.checkUpdates') }}
            data-testid="extensions-check-updates"
          >
            {t(checking ? 'extensions.updates.checking' : 'extensions.updates.check')}
          </Button>
        </Stack>
      </Stack>

      {loaded && checkedAt === '' && (
        <Text as="p" size="small" className={listStyles.muted} data-testid="extensions-updates-unchecked">
          {t('extensions.updates.notChecked')}
        </Text>
      )}
      {loaded && checkedAt !== '' && candidates.length === 0 && (
        <Text as="p" size="small" className={listStyles.muted} data-testid="extensions-updates-empty">
          {t('extensions.updates.empty')}
        </Text>
      )}
      {candidates.length > 0 && (
        <ul className={styles.rows} aria-label={t('extensions.tabs.updates')}>
          {candidates.map((c) => {
            const ctx: CommandContext = { kind: 'entity', entity: EXTENSION_ENTITY, id: c.ID }
            const badgeKey = tierLabelKey(c.Tier)
            const name = c.Name || c.ID
            return (
              <li key={c.ID} data-testid="extensions-update-row" data-plugin-id={c.ID}>
                <div className={styles.row}>
                  <span className={styles.rowButton}>
                    <PackageIcon size={16} className={styles.rowIcon} />
                    <Text size="small" weight="semibold" className={styles.rowName}>{name}</Text>
                    <Text size="small" className={styles.rowDescription} data-testid="extensions-update-versions">
                      {t('extensions.updates.versions', { from: c.Installed, to: c.Available })}
                    </Text>
                  </span>
                  <span className={styles.rowMeta}>
                    {c.Marketplace && <Text size="small" className={listStyles.muted}>{c.Marketplace}</Text>}
                    {badgeKey && <Label variant={tierVariant(c.Tier)}>{t(badgeKey)}</Label>}
                    <Button
                      size="small"
                      variant="primary"
                      onClick={() => { void runCommand('extension.update', ctx) }}
                      aria-label={t('extensions.updates.updateAria', { name })}
                      data-testid="extensions-update-apply"
                    >
                      {t('extensions.updates.update')}
                    </Button>
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {checkedAt !== '' && (
        <Text as="p" size="small" className={listStyles.muted} data-testid="extensions-updates-checked-at">
          {t('extensions.updates.checkedAt', { when: new Date(checkedAt).toLocaleString() })}
        </Text>
      )}
      {problems.length > 0 && (
        <Text as="p" size="small" className={listStyles.muted} data-testid="extensions-updates-problems">
          {t('extensions.updates.problems', { list: problems.join('; ') })}
        </Text>
      )}
    </Stack>
  )
}
