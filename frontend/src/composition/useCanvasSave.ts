import { useState } from 'react'
import type { Edge as RFEdge } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { CompositionService } from '../shared/bindings'
import type { Node as CompNode, Edge as CompEdge, Workflow } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import type { CanvasNode, CanvasNoteNode } from './canvasStore'
import { buildDraftWorkflowSchema } from './draftWorkflowSchema'
import { toDraftEdges, toDraftNodes, toDraftNotes } from './draftPayload'
import { clearScratch } from './canvasScratch'

export interface UseCanvasSaveResult {
  save: () => Promise<void>
  saving: boolean
  saveError: string
}

// Split out of CompositionCanvas.tsx once view mode (docs/goals/0022)
// pushed that file back over the 500-line limit (CLAUDE.md) -- the
// zod-validate-then-Create/UpdateWorkflow logic is self-contained
// enough to own its own saving/saveError state, same "split along a
// real seam" discipline useCanvasHotExit.ts/useCanvasLiveSync.ts
// already established for this file's other non-rendering concerns.
export function useCanvasSave(
  workflow: Workflow | null | undefined,
  tabKey: string,
  // docs/goals/0022: no Save affordance exists in view mode
  // (CanvasMetaHeader hides it), but workflow.save's own keyboard
  // shortcut (⌘S, useCanvasCommandDispatch) can still reach this
  // function -- guarded here too rather than trusting the UI is the
  // only entry point.
  readOnly: boolean,
  draftLabel: string,
  draftDescription: string,
  nodes: CanvasNode[],
  edges: RFEdge[],
  notes: CanvasNoteNode[],
  onSaved: () => void,
): UseCanvasSaveResult {
  const { t } = useTranslation('composition')
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (readOnly) return
    setSaveError('')
    const draft = {
      Label: draftLabel,
      Description: draftDescription,
      Nodes: toDraftNodes(nodes),
      Edges: toDraftEdges(edges),
    }
    const parsed = buildDraftWorkflowSchema(t).safeParse(draft)
    if (!parsed.success) {
      setSaveError(parsed.error.issues[0]?.message ?? t('draftWorkflowSchema.notValidYetFallback'))
      return
    }
    setSaving(true)
    try {
      // Notes (docs/goals/0055) save through their own RPC, the same
      // shape UpdateAttributes already established for a workflow-scoped
      // collection that isn't Nodes/Edges -- CreateWorkflow/UpdateWorkflow
      // never take Notes directly, so this always needs the id from
      // whichever branch below just ran.
      const savedID = workflow
        ? (
            await CompositionService.UpdateWorkflow(
              workflow.ID,
              parsed.data.Label,
              parsed.data.Description,
              parsed.data.Nodes as CompNode[],
              parsed.data.Edges as CompEdge[],
            )
          ).ID
        : (
            await CompositionService.CreateWorkflow(
              parsed.data.Label,
              parsed.data.Description,
              parsed.data.Nodes as CompNode[],
              parsed.data.Edges as CompEdge[],
            )
          ).ID
      await CompositionService.UpdateNotes(savedID, toDraftNotes(notes))
      // A successful Save is one of the two events that discard the
      // hot-exit scratch (docs/goals/0012) -- the draft it was
      // shadowing no longer exists as "unsaved." onSaved() closes this
      // tab (app/WorkTabShell.tsx), which also prunes workTabDirty/
      // workTabRestored for tabKey -- this call only needs to handle
      // the localStorage side, which shared/store.ts can't reach (it's
      // a dependency-cruiser leaf and can't import composition/).
      clearScratch(tabKey)
      onSaved()
    } catch (err) {
      setSaveError(String(err))
    } finally {
      setSaving(false)
    }
  }

  return { save, saving, saveError }
}
