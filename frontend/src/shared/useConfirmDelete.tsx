import { useState } from 'react'
import { ConfirmDialog } from './ConfirmDialog'

// Small state-glue wrapper around ConfirmDialog for the "table-view
// icon button" half of the Button-semantics convention
// (.claude/rules/frontend.md): InventoryList's rows get confirmation
// for free via its own opt-in `confirm` field, but a page's DataTable
// view (and RequestSummary's own trailing trash icon) wire a
// TrashIcon's onClick directly -- this is that direct-wiring path,
// shared once it was about to be written a sixth time (CLAUDE.md: a
// fourth repetition is the signal to share it) across WorkflowsTable
// and five Configure pages. Pure state passthrough, no branching logic
// worth a unit test (.claude/rules/testing.md's "keep it dumb" note).
export function useConfirmDelete<T>({ entityType, labelOf, onConfirm }: {
  entityType: string
  labelOf: (item: T) => string
  onConfirm: (item: T) => void
}) {
  const [pending, setPending] = useState<T | null>(null)

  const dialog = pending !== null && (
    <ConfirmDialog
      title={`Delete ${entityType}?`}
      body={`This permanently deletes "${labelOf(pending)}". This cannot be undone.`}
      onCancel={() => setPending(null)}
      onConfirm={() => {
        onConfirm(pending)
        setPending(null)
      }}
    />
  )

  return { requestDelete: setPending, dialog }
}
