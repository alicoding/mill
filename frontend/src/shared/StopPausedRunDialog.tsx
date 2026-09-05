import { Dialog, Text } from '@primer/react'
import { useTranslation } from 'react-i18next'

// The one prompt for "a run of this workflow is sitting paused" (goal
// 0328). Two moments ask it -- leaving the editor, and starting a second
// stepped run of the same workflow -- and both offer the same three ways
// out, so only the title changes between them.
//
// Stop run is the default: a paused run holds its step indefinitely, and
// leaving one behind by accident is the outcome worth defaulting away
// from. Keep it paused is the deliberate choice, and the run stays
// listed under Activity where it can be answered later.
export function StopPausedRunDialog({
  title, stepLabel, onStop, onKeep, onCancel,
}: {
  title: string
  // The step the run is parked at, so the prompt names what is being
  // stopped rather than asking about an unidentified run.
  stepLabel: string
  onStop: () => void
  onKeep: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation('common')
  return (
    <Dialog
      title={title}
      onClose={onCancel}
      role="alertdialog"
      footerButtons={[
        { content: t('stopPausedRun.cancel'), onClick: onCancel },
        { content: t('stopPausedRun.keep'), onClick: onKeep },
        { content: t('stopPausedRun.stop'), buttonType: 'danger', onClick: onStop, autoFocus: true },
      ]}
    >
      <Text as="p" data-testid="stop-paused-run-step">{t('stopPausedRun.body', { step: stepLabel })}</Text>
    </Dialog>
  )
}
