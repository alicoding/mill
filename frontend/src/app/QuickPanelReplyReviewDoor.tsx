import { SettingsService } from '../shared/bindings'
import type { ClipbridgeReplyPreview } from '../shared/bindings'
import { QuickPanelReplyReview } from './QuickPanelReplyReview'
import styles from './QuickPanel.module.css'

interface Props {
  preview: ClipbridgeReplyPreview
  t: (key: string, opts?: Record<string, unknown>) => string
  onCancel: () => void
  onApplied: (status: string) => void
}

// The panel-body wrapper around QuickPanelReplyReview -- split out of
// QuickPanel.tsx for the same 500-line reason
// QuickPanelClipboardApplyDoor.tsx's own header comment states.
// Behavior unchanged: dismisses the panel 600ms after a successful
// apply, same as before this split.
export function QuickPanelReplyReviewDoor({ preview, t, onCancel, onApplied }: Props) {
  return (
    <div className={styles.panel} data-testid="quick-panel">
      <QuickPanelReplyReview
        preview={preview}
        onCancel={onCancel}
        onApplied={(label) => {
          onApplied(t('quickPanel.status.replyApplied', { label }))
          window.setTimeout(() => { void SettingsService.DismissPanel().catch(() => {}) }, 600)
        }}
      />
    </div>
  )
}
