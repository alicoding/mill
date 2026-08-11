import { useCallback, useEffect } from 'react'
import { GuardrailService } from '../shared/bindings'
import type { CanvasNode, CanvasState } from './canvasStore'

// Nothing-hidden guardrail badges (docs/adr/0022's Update): fetch the
// saved workflow's per-step verdicts so a step that will ask or deny is
// marked on the canvas before anyone runs it -- split out of
// CompositionCanvas.tsx once that file crossed the 500-line limit
// (CLAUDE.md/§1.3), the same "split along a real seam" discipline
// useDraftValidation.ts already established for the authoring-
// validation surface.
//
// Returns a stable `refresh` function (not just an internal effect) so
// the Inspector's own "Breakpoint" toggle (docs/adr/0031 item 1) can
// trigger the SAME refetch on demand: toggling a debug rule doesn't
// change any node's type/config, so the fingerprint-keyed effect alone
// would never notice it, and "visible as the debug badge before any
// run" (the acceptance criterion) needs it to update immediately, not
// on the next unrelated canvas edit.
export function useGuardrailBadges(workflowId: string | undefined, nodes: CanvasNode[], setGuardrailVerdicts: CanvasState['setGuardrailVerdicts']): () => void {
  // Keyed on node membership/type/config so adding an external step or
  // repointing a requestId refreshes the badge; a brand-new unsaved
  // workflow has no ID to evaluate against yet (badges appear after the
  // first save).
  const nodeFingerprint = nodes.map((n) => `${n.id}:${n.data.nodeTypeID}:${n.data.config.requestId ?? ''}`).join('|')

  const refresh = useCallback(() => {
    if (!workflowId) return
    GuardrailService.WorkflowVerdicts(workflowId)
      .then((v) => setGuardrailVerdicts((v ?? {}) as Record<string, { effect: string; ruleLabel: string; source?: string }>))
      .catch(() => {})
  }, [workflowId, setGuardrailVerdicts])

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowId, nodeFingerprint])

  return refresh
}
