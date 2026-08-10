import { useEffect, useState } from 'react'
import type { Edge as RFEdge } from '@xyflow/react'
import { CompositionService } from '../shared/bindings'
import type { AttributeDef, Issue } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import type { CanvasNode } from './canvasStore'
import { toDraftEdges, toDraftNodes } from './draftPayload'

const DEBOUNCE_MS = 500

// The editor's own authoring-validation surface (docs/adr/0028):
// debounced 500ms after nodes/edges/config settle, calling
// CompositionService.ValidateDraft against not-yet-saved canvas
// state -- a real round trip through ResolveNodeDefaults + the full
// composition.ValidateGraph rule walk, not a free client-side check
// (draftWorkflowSchema.ts's zod pass already covers that cheaper,
// draw-time layer). Returns every issue found, errors and warnings
// alike; CompositionCanvas.tsx renders the toolbar badge/panel and
// per-node canvas badges from this.
export function useDraftValidation(nodes: CanvasNode[], edges: RFEdge[], attrs: AttributeDef[] | null | undefined): Issue[] {
  const [issues, setIssues] = useState<Issue[]>([])

  // A fingerprint, not the raw arrays, drives the effect: React Flow's
  // own onNodesChange/onConnect hand back new array/object identities
  // on every change (including ones that don't affect validation, like
  // a node drag), so depending on the arrays directly would re-arm the
  // debounce timer on every render instead of only when something that
  // actually matters to ValidateDraft changes. Position is deliberately
  // excluded -- dragging a node around the canvas is not a graph change.
  const fingerprint = JSON.stringify({
    nodes: nodes.map((n) => ({ id: n.id, kind: n.data.kind, nodeTypeID: n.data.nodeTypeID, config: n.data.config })),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, condition: (e.data as { condition?: string } | undefined)?.condition ?? '' })),
    attrs,
  })

  useEffect(() => {
    if (nodes.length === 0) {
      setIssues([])
      return
    }
    const timer = window.setTimeout(() => {
      CompositionService.ValidateDraft(toDraftNodes(nodes), toDraftEdges(edges), attrs ?? [])
        .then((result) => setIssues(result ?? []))
        .catch(() => setIssues([]))
    }, DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint])

  return issues
}

// groupIssuesByNode reshapes a flat issue list into the per-node map
// canvasStore.setValidationIssues (and CanvasNodeView's per-node badge)
// need -- issues with no NodeID (a whole-graph problem like "no
// starting node") are skipped here, since there's no single node to
// badge; they still show up in the toolbar panel via the flat list.
export function groupIssuesByNode(issues: Issue[]): Record<string, { severity: string; message: string }[]> {
  const byNode: Record<string, { severity: string; message: string }[]> = {}
  for (const issue of issues) {
    if (!issue.NodeID) continue
    ;(byNode[issue.NodeID] ??= []).push({ severity: issue.Severity, message: issue.Message })
  }
  return byNode
}
