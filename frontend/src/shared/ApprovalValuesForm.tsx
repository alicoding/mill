import { FormControl, Stack, Text, TextInput } from '@primer/react'
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
      <Text size="small" weight="semibold">{label ?? 'Your input (optional — flows into the resumed run)'}</Text>
      {attrs.map((a) => (
        <FormControl key={a.Key}>
          <FormControl.Label>{a.Label || a.Key}</FormControl.Label>
          <TextInput
            size="small"
            value={values[a.Key] ?? ''}
            placeholder="leave empty to keep the current value"
            onChange={(e) => onChange(a.Key, e.target.value)}
          />
        </FormControl>
      ))}
    </Stack>
  )
}

// attrsForPending: given a workflow's full declared Attributes and an
// optional requested-subset list (PendingApproval.inputAttributes, goal
// 0001), returns the ones actually worth asking for -- empty/absent
// means all. A non-component export alongside ApprovalValuesForm trips
// react-refresh/only-export-components (a Fast Refresh perf lint, not a
// correctness one) -- accepted as a harmless warning (0 errors) rather
// than splitting a one-line pure helper into its own file for a lint
// rule that doesn't apply to a `npm run build` output.
export function attrsForPending(all: AttributeDef[], requested: string[] | null | undefined): AttributeDef[] {
  return requested && requested.length > 0 ? all.filter((a) => requested.includes(a.Key)) : all
}
