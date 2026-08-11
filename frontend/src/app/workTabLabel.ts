import type { WorkTab } from '../shared/store'

// The display label for an open work tab -- shared by app/WorkTabShell.tsx
// (the tab strip itself) and app/CommandPalette.tsx (the palette's tabs
// group, docs/goals/0015-summon-quick-invoke.md), so both agree on the
// exact same "what does this open work item display as" derivation
// instead of two independent copies drifting apart. Split into its own
// non-component file rather than exported from WorkTabShell.tsx itself
// -- that tripped react-refresh's "a file exporting a component should
// only export components" lint rule the moment a second, non-component
// export was added to it.
export function tabLabel(tab: WorkTab, workflowLabel: (id: string) => string | undefined, requestLabel: (id: string) => string | undefined): string {
  switch (tab.kind) {
    case 'workflow-edit':
      return workflowLabel(tab.workflowId) ?? 'Workflow'
    case 'workflow-new':
      return 'New workflow'
    case 'request-view':
    case 'request-edit':
      return requestLabel(tab.requestId) ?? 'Integration'
    case 'request-new':
      return 'New integration'
  }
}
