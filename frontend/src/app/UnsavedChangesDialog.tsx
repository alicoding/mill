import { Dialog, Text } from '@primer/react'
import { useTranslation } from 'react-i18next'
import { discardAll, usePendingFlushCount } from '../shared/flushRegistry'
import { findCommand } from '../shared/commands'
import { useUISignalStore } from '../shared/uiSignalStore'
import { answerLeave } from './useBeforeQuitFlush'

// The leave sheet (goal 0295 S2b): explicit save mode's guard on quit,
// restart and window close -- the document-app "Save changes?" sheet,
// draw.io's own close guard. Same three-way shape as CloseTabDialog
// (goal 0048): Cancel autofocuses (the safe landing for a stray
// Enter), Discard is the destructive one, Save all is the one primary
// action and renders the edit.saveAll command. Mounted once at
// app-level chrome, renders off the signal store's unsavedLeave.
export function UnsavedChangesDialog() {
  const { t } = useTranslation('app')
  const reason = useUISignalStore((s) => s.unsavedLeave)
  const count = usePendingFlushCount()
  if (!reason) return null
  const title = reason === 'restart'
    ? t('unsavedChangesDialog.titleRestart')
    : reason === 'close'
      ? t('unsavedChangesDialog.titleClose')
      : t('unsavedChangesDialog.titleQuit')
  return (
    <Dialog
      title={title}
      onClose={() => answerLeave(false)}
      role="alertdialog"
      footerButtons={[
        { content: t('unsavedChangesDialog.cancel'), onClick: () => answerLeave(false), autoFocus: true },
        {
          content: t('unsavedChangesDialog.discard'),
          buttonType: 'danger',
          onClick: () => {
            discardAll()
            answerLeave(true)
          },
        },
        {
          content: t('unsavedChangesDialog.saveAll'),
          buttonType: 'primary',
          onClick: () => {
            // The command's flush is bounded; the answer follows it so a
            // hung surface can never hold the quit past that bound.
            const run = findCommand('edit.saveAll')?.run()
            void Promise.resolve(run).finally(() => answerLeave(true))
          },
        },
      ]}
    >
      <Text as="p" data-testid="unsaved-changes-body">{t('unsavedChangesDialog.body', { count })}</Text>
    </Dialog>
  )
}
