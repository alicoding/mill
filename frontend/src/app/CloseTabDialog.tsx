import { Dialog, Text } from '@primer/react'
import { useTranslation } from 'react-i18next'

// The single-dirty-tab close prompt (docs/goals/0048-unsaved-close-
// guard.md): three ways out, unlike shared/ConfirmDialog's two-button
// shape, so it stays its own component rather than an extra prop
// bolted onto that one. Cancel autofocuses (the safe default a stray
// Enter should land on, matching ConfirmDialog's own convention); Save
// is the one primary action; Don't save is the destructive one
// (.claude/rules/frontend.md's button-semantics rules (a)/(b)).
export function CloseTabDialog({
  label, onSave, onDontSave, onCancel,
}: {
  label: string
  onSave: () => void
  onDontSave: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation('app')
  return (
    <Dialog
      title={t('closeTabDialog.title', { label })}
      onClose={onCancel}
      role="alertdialog"
      footerButtons={[
        { content: t('closeTabDialog.cancel'), onClick: onCancel, autoFocus: true },
        { content: t('closeTabDialog.dontSave'), buttonType: 'danger', onClick: onDontSave },
        { content: t('closeTabDialog.save'), buttonType: 'primary', onClick: onSave },
      ]}
    >
      <Text as="p">{t('closeTabDialog.body')}</Text>
    </Dialog>
  )
}
