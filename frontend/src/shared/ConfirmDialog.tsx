import { Dialog, Text } from '@primer/react'
import type { ReactNode } from 'react'

// The one shared destructive-action confirmation (Button-semantics
// convention: .claude/rules/frontend.md's "Button semantics" section /
// docs/SPEC.md §3.8). Rule (b) requires irreversible destruction of a
// persisted entity to be danger-styled AND confirmed via a dialog
// naming the entity, not fired straight off a kebab-menu click or a
// bare trash icon. Built on Primer's own Dialog (footerButtons +
// buttonType: 'danger'), matching Mill's existing controlled-dialog
// convention (TestRunDialog.tsx: state-driven, rendered inline) rather
// than Primer's imperative useConfirm()/ConfirmationDialog helper --
// that hook mounts a second React root outside the app tree
// (createRoot appended to document.body), which doesn't fit how every
// other Mill dialog is wired. Cancel autofocuses by default -- Primer's
// own ConfirmationDialog does the same when its confirm button is
// dangerous -- so the safe path is what a stray Enter activates.
export function ConfirmDialog({
  title, body, confirmLabel = 'Delete', cancelLabel = 'Cancel', onCancel, onConfirm,
}: {
  title: ReactNode
  body: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog
      title={title}
      onClose={onCancel}
      role="alertdialog"
      footerButtons={[
        { content: cancelLabel, onClick: onCancel, autoFocus: true },
        { content: confirmLabel, buttonType: 'danger', onClick: onConfirm },
      ]}
    >
      <Text as="p">{body}</Text>
    </Dialog>
  )
}
