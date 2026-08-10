import { useState } from 'react'
import { AnchoredOverlay, Label, Stack, Text } from '@primer/react'
import { AlertFillIcon, XCircleFillIcon } from '@primer/octicons-react'
import type { Issue } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import styles from './CompositionCanvas.module.css'

// The editor's own authoring-validation surface (docs/adr/0028): a
// toolbar badge naming how many errors/warnings the current draft
// carries, hidden entirely once there are none, and an anchored panel
// (Primer's AnchoredOverlay, the same click-to-open popover
// WorkflowHoverPreview.tsx already established for a hover variant)
// listing every issue -- clicking one selects its offending node/edge
// on the canvas. Errors block Save; warnings never do (composition.go's
// ValidateGraphStrict), but both surface here since the whole point is
// nothing hidden before a save attempt, not just what will fail it.
export function ValidationSurface({ issues, onSelectIssue }: {
  issues: Issue[]
  onSelectIssue: (issue: Issue) => void
}) {
  const [open, setOpen] = useState(false)
  if (issues.length === 0) return null

  const errorCount = issues.filter((i) => i.Severity === 'error').length
  const warningCount = issues.length - errorCount
  const parts: string[] = []
  if (errorCount > 0) parts.push(`${errorCount} error${errorCount === 1 ? '' : 's'}`)
  if (warningCount > 0) parts.push(`${warningCount} warning${warningCount === 1 ? '' : 's'}`)

  return (
    <AnchoredOverlay
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      overlayProps={{ role: 'dialog', 'aria-label': 'Workflow validation issues' }}
      renderAnchor={(anchorProps) => (
        <Label
          {...anchorProps}
          as="button"
          variant={errorCount > 0 ? 'danger' : 'attention'}
          size="small"
          data-testid="validation-badge"
          className={styles.validationBadge}
        >
          {parts.join(' · ')}
        </Label>
      )}
    >
      <div className={styles.validationPanel} data-testid="validation-panel">
        <Stack direction="vertical" gap="condensed">
          {issues.map((issue, i) => (
            <button
              key={`${issue.NodeID}-${issue.EdgeID}-${i}`}
              type="button"
              className={styles.validationRow}
              data-testid="validation-issue"
              data-severity={issue.Severity}
              onClick={() => {
                onSelectIssue(issue)
                setOpen(false)
              }}
            >
              {issue.Severity === 'error' ? <XCircleFillIcon size={14} /> : <AlertFillIcon size={14} />}
              <Text size="small">{issue.Message}</Text>
            </button>
          ))}
        </Stack>
      </div>
    </AnchoredOverlay>
  )
}
