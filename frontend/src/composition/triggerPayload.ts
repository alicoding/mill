import type { Workflow } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'

// Which trigger node types deliver real event data as the run's
// initial payload (docs/SPEC.md §3.4: a trigger's output IS the
// workflow's input), and the human hint for substituting it on a
// manual test run. Only filesystem-watch supplies one today -- when a
// second trigger type gains a payload, its entry lands here alongside
// the Go-side fire() change, one vocabulary.
const TRIGGER_PAYLOAD_HINTS: Record<string, string> = {
  'trigger-filesystem-watch':
    'What the watcher would deliver: the changed file’s full path (e.g. a saved page’s .html).',
}

// The workflow's trigger-supplied-payload hint, or null when its
// trigger has no event data to substitute (manual/hotkey/schedule) --
// null means the Run dialog shows no Initial-payload field, exactly
// the pre-existing behavior.
export function workflowPayloadHint(workflow: Pick<Workflow, 'Nodes'> | null | undefined): string | null {
  const root = workflow?.Nodes?.find((n) => n.Kind === 'trigger')
  if (!root) return null
  return TRIGGER_PAYLOAD_HINTS[root.NodeTypeID] ?? null
}
