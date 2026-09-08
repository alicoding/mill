import { useTranslation } from 'react-i18next'
import { ActionBar, IconButton, Stack, Text } from '@primer/react'
import { XIcon } from '@primer/octicons-react'
import { COMMANDS, commandAvailable, commandLabel, runCommand } from './commands'
import { useAppStore } from './store'
import styles from './SelectionBar.module.css'

// Replaces ListToolbar in place while a list is in selection mode
// (goal 0404 S1, Decision 2): count, the surface's own bulk commands
// (registry commands flagged `bulk: true`, never a bar-local action
// list -- architecture.md's "every user-facing action is a registry
// command"), "Select all {N}" once the selection is partial against
// the full filtered count, and Cancel. Every action dispatches through
// runCommand with NO context -- list.deleteSelection and friends read
// the focused list's own handle (shared/listSelectionFocus.ts), the
// same shape listGrid.search's commands already read a focused mount
// through.
export function SelectionBar({ count, totalCount, onSelectAllOf, onCancel }: {
  count: number
  totalCount: number
  onSelectAllOf: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation('common')
  const surface = useAppStore((s) => s.view.kind)
  const bulkCommands = COMMANDS.filter((c) => c.bulk && (!c.surface || c.surface.includes(surface)) && commandAvailable(c))
  const partial = count < totalCount

  return (
    <Stack direction="horizontal" gap="condensed" align="center" className={styles.bar} data-testid="selection-bar">
      <Text size="small" weight="semibold" data-testid="selection-bar-count">
        {t('selectionBar.selectedCount', { count })}
      </Text>
      <div className={styles.spacer}>
        <ActionBar aria-label={t('selectionBar.actionsAriaLabel')}>
          {partial && (
            <ActionBar.Button data-testid="selection-bar-select-all" onClick={onSelectAllOf}>
              {t('selectionBar.selectAllOf', { count: totalCount })}
            </ActionBar.Button>
          )}
          {bulkCommands.map((c) => (
            <ActionBar.Button
              key={c.id}
              data-testid={`selection-bar-action-${c.id}`}
              variant={c.id === 'list.deleteSelection' ? 'danger' : 'default'}
              onClick={() => void runCommand(c.id)}
            >
              {commandLabel(c)}
            </ActionBar.Button>
          ))}
        </ActionBar>
      </div>
      <IconButton
        icon={XIcon}
        aria-label={t('selectionBar.cancelAriaLabel')}
        variant="invisible"
        size="small"
        onClick={onCancel}
        data-testid="selection-bar-cancel"
      />
    </Stack>
  )
}
