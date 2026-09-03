import type { WorkTabSpec } from '../shared/workTabs'

// Where a reference field's "Open" lands (goal 0312): an Integration
// and a workflow are work tabs beside the canvas (the user returns by
// clicking their own tab); every other Configure kind lands on its
// Configure tab with that entity's editor opened by the edit signal.
export type ReferenceOpenTarget =
  | { kind: 'work-tab'; spec: WorkTabSpec }
  | { kind: 'configure'; tab: string }

const CONFIGURE_TAB_FOR_KIND: Record<string, string> = {
  list: 'lists',
  mcpserver: 'mcpservers',
  decision: 'decisions',
  execenv: 'execenvs',
  aiprovider: 'aiproviders',
  conversionprofile: 'conversionprofiles',
}

// SUMMARY_KINDS are the kinds DescribeReference answers for.
export const SUMMARY_KINDS = new Set(['request', ...Object.keys(CONFIGURE_TAB_FOR_KIND)])

export function referenceOpenTarget(refKind: string, id: string): ReferenceOpenTarget | null {
  if (!id) return null
  if (refKind === 'request') return { kind: 'work-tab', spec: { kind: 'request-edit', requestId: id } }
  if (refKind === 'workflow' || refKind === 'workflow-scope') return { kind: 'work-tab', spec: { kind: 'workflow-edit', workflowId: id, mode: 'view' } }
  const tab = CONFIGURE_TAB_FOR_KIND[refKind]
  return tab ? { kind: 'configure', tab } : null
}
