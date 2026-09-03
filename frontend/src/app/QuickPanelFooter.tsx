import { ActionList, ActionMenu, Button, Text } from '@primer/react'
import { KeyComboChip } from '../shared/KeyComboChip'
import type { RowAction } from './useQuickPanelWorkflowActions'
import styles from './QuickPanel.module.css'

// The panel's footer (goal 0294): the run outcome on the left, the
// active row's shortcut hints and the Actions menu on the right --
// the launcher footer people already read. The menu lists every row
// action with its own shortcut; ⌘K toggles it from the keyboard.
export function QuickPanelFooter({ status, hasWorkflowRow, actions, open, onOpenChange, t }: {
  status: string | null
  hasWorkflowRow: boolean
  actions: RowAction[]
  open: boolean
  onOpenChange: (open: boolean) => void
  t: (key: string, opts?: Record<string, unknown>) => string
}) {
  return (
    <div className={styles.footer} data-testid="quick-panel-footer">
      <Text as="span" size="small" className={styles.footerStatus} data-testid="quick-panel-status">
        {status ?? ''}
      </Text>
      <span className={styles.footerHints}>
        {hasWorkflowRow && (
          <span className={styles.footerHint}>
            {t('quickPanel.actions.run')} <KeyComboChip label="↩" data-testid="quick-panel-run-hint" />
          </span>
        )}
        <ActionMenu open={open} onOpenChange={onOpenChange}>
          <ActionMenu.Anchor>
            <Button size="small" variant="invisible" disabled={!hasWorkflowRow} data-testid="quick-panel-actions-button">
              {t('quickPanel.actions.menu')} <KeyComboChip label="⌘K" data-testid="quick-panel-actions-hint" />
            </Button>
          </ActionMenu.Anchor>
          <ActionMenu.Overlay align="end" side="outside-top">
            <ActionList>
              {actions.map((action) => (
                <ActionList.Item key={action.id} onSelect={action.run} data-testid={`quick-panel-action-${action.id}`}>
                  {action.label}
                  <ActionList.TrailingVisual>
                    <KeyComboChip label={action.shortcut} data-testid={`quick-panel-action-${action.id}-shortcut`} />
                  </ActionList.TrailingVisual>
                </ActionList.Item>
              ))}
            </ActionList>
          </ActionMenu.Overlay>
        </ActionMenu>
      </span>
    </div>
  )
}
