import { SettingsService } from '../shared/bindings'
import type { ClipboardApplyPreview } from '../shared/bindings'
import { QuickPanelClipboardApply } from './QuickPanelClipboardApply'
import styles from './QuickPanel.module.css'
import { background } from '../shared/background'

interface Props {
  json: string
  preview: ClipboardApplyPreview
  t: (key: string, opts?: Record<string, unknown>) => string
  onCancel: () => void
  onApplied: (status: string) => void
}

// The panel-body wrapper around QuickPanelClipboardApply (docs/goals/
// 0039) -- split out of QuickPanel.tsx purely to keep that file under
// CLAUDE.md's 500-line convention, same reasoning QuickPanelCodingLoop.tsx's
// own header comment states for the coding loop's door. Behavior
// unchanged: dismisses the panel 600ms after a successful apply, same
// as before this split.
export function QuickPanelClipboardApplyDoor({ json, preview, t, onCancel, onApplied }: Props) {
  return (
    <div className={styles.panel} data-testid="quick-panel">
      <QuickPanelClipboardApply
        json={json}
        preview={preview}
        onCancel={onCancel}
        onApplied={(label, isUpdate) => {
          onApplied(isUpdate ? t('quickPanel.status.appliedUpdated', { label }) : t('quickPanel.status.appliedCreated', { label }))
          window.setTimeout(() => { void background(SettingsService.DismissPanel(), 'quickPanelClipboardApply.dismissPanel') }, 600)
        }}
      />
    </div>
  )
}
