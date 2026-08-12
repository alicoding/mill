import { useState } from 'react'
import { Banner, Button, Stack, Text } from '@primer/react'
import { ArrowLeftIcon } from '@primer/octicons-react'
import { CompositionService, ClipboardApplyAction } from '../shared/bindings'
import type { ClipboardApplyPreview } from '../shared/bindings'
import styles from './QuickPanelClipboardApply.module.css'

// docs/goals/0039: the Quick Panel's "Apply from clipboard..." row swaps
// the panel body into this preview-confirm view instead of opening a
// second window/dialog (ADR-0033's floating panel has no room for
// nested chrome) -- QuickPanel.tsx owns the swap + the clipboard read
// itself, this component only ever renders whatever PreviewClipboardApply
// already returned and, on Confirm, calls ConfirmClipboardApply with the
// SAME json string the preview was computed from (re-parsed
// server-side, never trusted from the client's cached verdict -- see
// ConfirmClipboardApply's own doc comment).
//
// Deliberately NOT routed through gateWrite/park-and-poll (ADR-0032):
// invoking this action IS the human being present, unlike an MCP write
// from a possibly-away remote agent -- one inline preview, one Confirm,
// no second gate.

interface Props {
  json: string
  preview: ClipboardApplyPreview
  onCancel: () => void
  onApplied: (label: string, isUpdate: boolean) => void
}

export function QuickPanelClipboardApply({ json, preview, onCancel, onApplied }: Props) {
  const [busy, setBusy] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)

  // Malformed JSON / an unrecognized shape -- readable, never silent
  // (time-honesty, .claude/rules/testing.md).
  if (!preview.recognized) {
    return (
      <Stack className={styles.panel} gap="condensed" data-testid="quick-panel-clipboard-apply-error">
        <Banner variant="critical" title="Couldn't read that as a Mill export" description={preview.error} />
        <Button leadingVisual={ArrowLeftIcon} onClick={onCancel} block>Back</Button>
      </Stack>
    )
  }

  const isUpdate = preview.action === ClipboardApplyAction.ClipboardApplyActionUpdate
  const nodeCount = preview.nodeCount ?? 0
  const summary = isUpdate
    ? `This will UPDATE "${preview.label}" — replacing the current draft (the published version stays untouched until you publish).`
    : `This will CREATE "${preview.label}" (${nodeCount} node${nodeCount === 1 ? '' : 's'}).`

  const confirm = () => {
    setBusy(true)
    setConfirmError(null)
    CompositionService.ConfirmClipboardApply(json)
      .then((wf) => onApplied(wf.Label, isUpdate))
      .catch((err) => {
        setBusy(false)
        setConfirmError(String(err))
      })
  }

  const unresolved = preview.unresolved ?? []

  return (
    <Stack className={styles.panel} gap="condensed" data-testid="quick-panel-clipboard-apply-preview">
      <Text as="p" data-testid="quick-panel-clipboard-apply-summary">{summary}</Text>
      {preview.note && (
        <Text as="p" size="small" className={styles.note} data-testid="quick-panel-clipboard-apply-note">{preview.note}</Text>
      )}
      {unresolved.length > 0 && (
        <Banner
          variant="warning"
          title={`${unresolved.length} reference${unresolved.length === 1 ? '' : 's'} won't resolve here`}
          data-testid="quick-panel-clipboard-apply-unresolved"
          description={
            <ul className={styles.unresolvedList}>
              {unresolved.map((ref, i) => (
                <li key={`${ref.nodeID}-${ref.field}-${i}`}>
                  node <code>{ref.nodeID}</code>: <code>{ref.field}</code> ({ref.refKind}) references
                  {' '}"{ref.value}", which doesn't exist here — point it at one before running
                </li>
              ))}
            </ul>
          }
        />
      )}
      {confirmError && (
        <Banner variant="critical" title="Apply failed" description={confirmError} data-testid="quick-panel-clipboard-apply-confirm-error" />
      )}
      <Stack direction="horizontal" gap="condensed" className={styles.actions}>
        <Button onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button
          variant="primary"
          onClick={confirm}
          disabled={busy}
          data-testid="quick-panel-clipboard-apply-confirm"
        >
          {busy ? 'Applying…' : isUpdate ? 'Update' : 'Create'}
        </Button>
      </Stack>
    </Stack>
  )
}
