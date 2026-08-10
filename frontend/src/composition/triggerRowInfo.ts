import type { Edge, Node } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'

// The workflow graph's root node -- Mill's Trigger node types (SPEC.md
// §3.4) are structurally the only valid graph root, so "the root node"
// and "the trigger node" are the same thing. Shared by WorkflowsCards.tsx's
// step-chain ordering (orderNodes) and the trigger-aware Workflows-list
// row label (TriggerRowLabel.tsx, docs/goals/0006-trigger-aware-
// workflows-list.md) -- extracted so both agree on the exact same
// derivation instead of two independent client-side computations of
// "the root" drifting apart. linearOrder (Go, composition.go) already
// guarantees a saved workflow has exactly one node with no incoming
// edge; this trusts that invariant (defensively returns null rather
// than throwing for the not-yet-composed/malformed case) instead of
// re-validating it -- same reasoning WorkflowsCards.tsx's original
// orderNodes already documented before this extraction.
export function findRootNode(nodes: Node[] | null, edges: Edge[] | null): Node | null {
  const nodeList = nodes ?? []
  const edgeList = edges ?? []
  if (nodeList.length === 0) return null
  const hasIncoming = new Set(edgeList.map((e) => e.Target))
  return nodeList.find((n) => !hasIncoming.has(n.ID)) ?? null
}
