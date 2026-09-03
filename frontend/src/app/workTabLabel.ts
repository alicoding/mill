import { getPluginView } from '../plugins/pluginViews'
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
// The tab's KIND line (the two-line work-tab pattern -- see
// shared/Tabs.tsx's kicker prop): which sort of entity the tab holds,
// shown small and uppercase above the label. Derived from the same
// WorkTabSpec kind the strip already switches on -- one vocabulary,
// same as entityIcons.ts's entity keys.
export function tabKindLabel(tab: WorkTab, t: (key: string) => string): string {
  switch (tab.kind) {
    case 'workflow-edit':
    case 'workflow-new':
      return t('workTabLabel.workflow')
    case 'request-view':
    case 'request-edit':
    case 'request-new':
      return t('workTabLabel.integration')
    case 'plugin-view':
      // The kicker names the PLUGIN (recognition before reading); the
      // label below it is the view's own title.
      return getPluginView(tab.pluginId, tab.viewId)?.pluginName ?? t('workTabLabel.pluginView')
  }
}

export function tabLabel(tab: WorkTab, workflowLabel: (id: string) => string | undefined, requestLabel: (id: string) => string | undefined, t: (key: string) => string): string {
  switch (tab.kind) {
    case 'workflow-edit':
      return workflowLabel(tab.workflowId) ?? t('workTabLabel.workflow')
    case 'workflow-new':
      return t('workTabLabel.newWorkflow')
    case 'request-view':
    case 'request-edit':
      return requestLabel(tab.requestId) ?? t('workTabLabel.integration')
    case 'request-new':
      return t('workTabLabel.newIntegration')
    case 'plugin-view':
      return getPluginView(tab.pluginId, tab.viewId)?.title ?? t('workTabLabel.pluginView')
  }
}
