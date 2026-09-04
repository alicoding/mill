import type { MCPWriteResolved, RunSummary } from '../shared/bindings'
import { runCommand } from '../shared/commands'
import { ENTITY_ICON } from '../shared/entityIcons'
import type { InventoryItem } from '../shared/inventoryItem'
import { formatRunStartedAt, runStatusLabel } from '../shared/runTime'
import { StatusStamp, type StatusStampVariant } from '../shared/StatusStamp'

// Review's recently-resolved history (goal 0337 S2, continuing goal
// 0026 item 6): a merged, newest-first list of run resolutions and
// resolved MCP writes, one section rather than two adjacent lists. MCP
// writes aren't scoped to a workflow, so a workflow filter excludes
// them entirely (nothing for them to match).
export type ResolvedEntry =
  | { kind: 'run'; key: string; time: number; run: RunSummary }
  | { kind: 'mcp-write'; key: string; time: number; write: MCPWriteResolved }

export function buildResolvedEntries(
  resolved: RunSummary[],
  resolvedWrites: MCPWriteResolved[],
  workflowFilter: string,
): ResolvedEntry[] {
  return [
    ...resolved
      .filter((r) => !workflowFilter || r.workflowID === workflowFilter)
      .map((run): ResolvedEntry => ({ kind: 'run', key: run.runID, time: Date.parse(run.completedAt || run.startedAt), run })),
    ...(workflowFilter ? [] : resolvedWrites.map((w): ResolvedEntry => ({ kind: 'mcp-write', key: w.id, time: Date.parse(w.resolvedAt), write: w }))),
  ].sort((a, b) => b.time - a.time)
}

// A failed run's status pill carries danger, never falls through to a
// neutral tone -- the same three-way mapping ActivityRunsExplorer.tsx's
// own run-status pill uses.
function runStatusVariant(run: RunSummary): StatusStampVariant {
  if (run.status === 'SUCCESS') return 'success'
  if (run.status === 'ERROR') return 'danger'
  return 'caution'
}

type TFunctionLike = (key: string, options?: Record<string, unknown>) => string

// resolvedEntryToInventoryItem keeps every resolved row's own click
// behavior: a run row opens its run through the run.open command with
// that row as its target (goal 0343 -- the same door the pending items
// and the tray use, docs/goals/0002 item 5's row drill-down); an MCP
// write has no run to drill into, so its onOpen is inert, the same as
// the non-interactive card it replaces.
export function resolvedEntryToInventoryItem(
  entry: ResolvedEntry,
  opts: { t: TFunctionLike },
): InventoryItem {
  if (entry.kind === 'run') {
    const { run } = entry
    return {
      id: run.runID,
      entity: 'run',
      icon: ENTITY_ICON.run,
      label: run.workflowLabel,
      description: run.resolution,
      labelBadges: (
        <StatusStamp variant={runStatusVariant(run)} data-testid="review-resolved-status">
          {runStatusLabel(run, opts.t)}
        </StatusStamp>
      ),
      updatedAt: run.startedAt,
      createdAt: run.startedAt,
      updatedLabel: formatRunStartedAt(run.startedAt),
      onOpen: () => { void runCommand('run.open', { kind: 'run', runId: run.runID, workflowId: run.workflowID }) },
      // Opening the run is the row's own click; the kebab would only
      // repeat it.
      menuActions: [],
    }
  }
  const { write } = entry
  return {
    id: write.id,
    entity: 'mcpwrite',
    icon: ENTITY_ICON.mcpwrite,
    label: write.description,
    description: write.status,
    updatedAt: write.resolvedAt,
    createdAt: write.resolvedAt,
    updatedLabel: formatRunStartedAt(write.resolvedAt),
    onOpen: () => { /* no run to drill into */ },
    menuActions: [],
  }
}
