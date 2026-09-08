// The Lists page's own reference-index copy (docs/goals/0392 Decision
// 3), split out of ConfigureLists.tsx so both it and the Unused
// filter's predicate are unit-testable without mounting the page.

export interface EntityUsageCount {
  Boards: number
  Workflows: number
}

// usageLineFor renders one List row's own usage summary: "Not used
// anywhere" when neither count is positive, else the two counted
// fragments joined. usage is undefined until ListUsageSummary's own
// first fetch returns, treated the same as zero so a fresh mount never
// flashes a wrong count.
export function usageLineFor(t: (key: string, opts?: Record<string, unknown>) => string, usage: EntityUsageCount | undefined): string {
  const boards = usage?.Boards ?? 0
  const workflows = usage?.Workflows ?? 0
  if (boards === 0 && workflows === 0) return t('configureLists.usageNone')
  return t('configureLists.usageLine', {
    boards: t('configureLists.usageBoards', { count: boards }),
    workflows: t('configureLists.usageWorkflows', { count: workflows }),
  })
}

// isUnusedList is the Unused filter's own predicate: usage genuinely
// known AND both counts are zero -- an unresolved usage (undefined)
// never counts as unused, so the filter can't show a false positive
// before ListUsageSummary's first fetch lands.
export function isUnusedList(usage: EntityUsageCount | undefined): boolean {
  return usage !== undefined && usage.Boards === 0 && usage.Workflows === 0
}
