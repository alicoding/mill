import { FormControl, Stack, Text, TextInput } from '@primer/react'
import { copy } from './copy'
import type { AttributeDef } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'

// The typed Attributes edit form a parked run's approver fills before
// resuming (docs/adr/0023's human-review input, generalized to every
// pending park by docs/adr/0031 item 4 -- "edit-and-resume": a paused
// run's forward-flowing data can be adjusted before it continues, never
// an already-committed checkpoint). Shared by views/ReviewView.tsx (the
// cross-workflow queue) and composition/WorkflowRunsPanel.tsx (a single
// workflow's own Runs tab), so the two can't drift on how a reviewer's
// typed input is collected -- lives in shared/ since both bounded
// contexts need it (composition/ can't import from views/, per
// .claude/rules/frontend.md's import direction).
export function ApprovalValuesForm({
  attrs, values, onChange, label,
}: {
  attrs: AttributeDef[]
  values: Record<string, string>
  onChange: (key: string, value: string) => void
  label?: string
}) {
  if (attrs.length === 0) return null
  return (
    <Stack direction="vertical" gap="condensed" onClick={(e) => e.stopPropagation()}>
      <Text size="small" weight="semibold">{label ?? copy('approvalValues.label')}</Text>
      {attrs.map((a) => (
        <FormControl key={a.Key}>
          <FormControl.Label>{a.Label || a.Key}</FormControl.Label>
          <TextInput
            size="small"
            value={values[a.Key] ?? ''}
            placeholder={copy('approvalValues.placeholder')}
            onChange={(e) => onChange(a.Key, e.target.value)}
          />
        </FormControl>
      ))}
    </Stack>
  )
}
