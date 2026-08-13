import type { Workflow } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'

// Frecency ranking for the Quick Panel's workflow list (docs/goals/
// 0015-summon-quick-invoke.md's remainder): "frequently-used float up
// without configuring anything." The usage substrate already exists --
// ExecutionService.HomeMetrics' MostUsed (executionservice_home.go's
// mostUsedFor, goal 0014's value mirror) counts every run regardless
// of Kind/Status in a given date window and ranks by RunCount desc --
// this is deliberately frequency-ONLY, not recency-weighted: the
// goal's own "frecency" language doesn't require recency-weighting
// beyond what the existing substrate already computes, and inventing
// a second ranking algorithm on top of an already-built one is exactly
// the kind of thing .claude/rules/architecture.md's reuse discipline
// warns against. Pins are OUT of scope here -- no pin/favorite concept
// exists anywhere in Mill yet (grepped before starting), recorded as
// its own smaller tech-debt line in docs/goals/BACKLOG.md rather than
// invented ad hoc.
//
// A pure, standalone function (not inlined in QuickPanel.tsx) so the
// sort behavior -- a run-having workflow ranks above a never-run one,
// ties keep their original order -- has real unit coverage
// (workflowFrecency.test.ts) independent of FilteredActionList's own
// rendering, per .claude/rules/testing.md.
export function sortWorkflowsByFrecency(workflows: Workflow[], runCounts: Record<string, number>): Workflow[] {
  // Array.prototype.sort is spec-guaranteed stable (ES2019+) -- two
  // workflows with equal (or absent, both 0) run counts keep their
  // original relative order rather than the comparator's tie-breaking
  // becoming a coin flip, so a fresh install's alphabetical fetch order
  // survives unchanged until real usage data exists to reorder it.
  return [...workflows].sort((a, b) => (runCounts[b.ID] ?? 0) - (runCounts[a.ID] ?? 0))
}

// Workflow pins/favorites (docs/goals/BACKLOG.md Standing #5, split
// from goal 0015's remainder, schema LOCKED at prioritization): pinned
// rows sort ABOVE every frecency-sorted unpinned row, in `pinnedIds`'s
// own order (pin recency -- see shared/store.ts's togglePinnedWorkflow).
// A plain partition-then-concat over the existing frecency sort rather
// than a new comparator -- reuses sortWorkflowsByFrecency for the
// unpinned tail instead of re-deriving frecency ordering here too.
export function sortWorkflowsByPinnedAndFrecency(
  workflows: Workflow[],
  runCounts: Record<string, number>,
  pinnedIds: string[],
): Workflow[] {
  const pinnedSet = new Set(pinnedIds)
  const pinned = pinnedIds
    .map((id) => workflows.find((wf) => wf.ID === id))
    .filter((wf): wf is Workflow => wf !== undefined)
  const unpinned = sortWorkflowsByFrecency(
    workflows.filter((wf) => !pinnedSet.has(wf.ID)),
    runCounts,
  )
  return [...pinned, ...unpinned]
}
