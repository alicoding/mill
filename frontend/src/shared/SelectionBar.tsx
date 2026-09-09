import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionBar, IconButton, Stack, Text } from '@primer/react'
import { XIcon } from '@primer/octicons-react'
import { COMMANDS, commandAvailable, commandLabel, runCommand } from './commands'
import { useAppStore } from './store'
import { useListSelectionFocusStore } from './listSelectionFocus'
import { ConfirmDialog } from './ConfirmDialog'
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
  // list.deleteSelection's own enabled() reads shared/listSelectionFocus.ts's
  // store (a plain, non-reactive `.getState()` getter -- the same read
  // the keydown listeners and runCommand use). Subscribing here too is
  // load-bearing, not decorative: without it this component has no
  // trigger of its own to re-render when the store updates in a
  // SEPARATE effect (InventoryList.tsx's focus-publish effects run
  // AFTER commit), so Delete could render missing right after the
  // FIRST selection and stay that way until some unrelated re-render
  // happened to catch it up.
  useListSelectionFocusStore((s) => s.focused)
  const bulkCommands = COMMANDS.filter((c) => c.bulk && (!c.surface || c.surface.includes(surface)) && commandAvailable(c))
  const partial = count < totalCount
  // A bulk action that asks first (goal 0406 S2's Delete forever, the
  // one irreversible bulk action here) shows its Command.confirm before
  // running -- every other bulk command omits confirm and runs
  // straight off the click, unchanged.
  const [pendingConfirm, setPendingConfirm] = useState<{ id: string; title: string; body: string; confirmLabel?: string } | null>(null)
  const invoke = (c: (typeof bulkCommands)[number]) => {
    const confirm = c.confirm?.()
    if (confirm) setPendingConfirm({ id: c.id, ...confirm })
    else void runCommand(c.id)
  }

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
              variant={c.id === 'list.deleteSelection' || c.id === 'list.destroySelection' ? 'danger' : 'default'}
              onClick={() => invoke(c)}
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
      {pendingConfirm && (
        <ConfirmDialog
          title={pendingConfirm.title}
          body={pendingConfirm.body}
          confirmLabel={pendingConfirm.confirmLabel}
          onCancel={() => setPendingConfirm(null)}
          onConfirm={() => {
            const id = pendingConfirm.id
            setPendingConfirm(null)
            void runCommand(id)
          }}
        />
      )}
    </Stack>
  )
}
