import { useEffect, useState } from 'react'
import { Tabs } from '@primer/react/experimental'
import type { NodeType, Workflow } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import CompositionCanvas from './CompositionCanvas'
import WorkflowRunsPanel from './WorkflowRunsPanel'
import { WorkflowVersionsPanel } from './WorkflowVersionsPanel'
import { TabItem, TabList, TabPanel } from '../shared/Tabs'
import { useAppStore } from '../shared/store'
import editorStyles from './CompositionView.module.css'

// A saved workflow's editor: an inner Canvas/Runs/Versions switch
// (docs/SPEC.md §7's Update; Versions per ADR-0021). A brand-new,
// not-yet-saved workflow (workflow === null) renders Canvas alone --
// no run history or versions exist yet. Extracted from
// CompositionView.tsx when the app-wide work-tab strip (§3.8) moved
// editor rendering out of the page and into app/WorkTabShell.tsx.
// Owns its inner-tab state locally: each open work tab's
// Canvas/Runs/Versions selection is independent.
export function WorkflowEditorTab({
  nodeTypes, workflow, tabKey, onBack, onSaved, onWorkflowsChanged,
}: {
  nodeTypes: NodeType[]
  workflow: Workflow | null
  // The owning WorkTab's own identity (shared/store.ts) -- passed
  // straight through to CompositionCanvas as its hot-exit scratch key
  // (docs/goals/0012-authoring-hot-exit.md). Not derived from
  // `workflow?.ID`: a brand-new workflow-new tab has no workflow id yet,
  // and its tab key IS the stable identity a restored scratch keys off.
  tabKey: string
  onBack: () => void
  onSaved: () => void
  // Refetches the workflow list without closing this tab -- what the
  // Versions tab's publish/disable/restore actions need (docs/adr/0021):
  // they mutate lifecycle state, not the draft being edited.
  onWorkflowsChanged: () => void
}) {
  const [innerTab, setInnerTab] = useState('canvas')

  // Review row drill-down (docs/goals/0002-review-queue-maturation.md
  // item 5): a pendingRunFocus targeting THIS workflow means someone
  // clicked a Review row asking for this run -- land on the Runs inner
  // tab with it preselected. Read here (not just passed straight
  // through) because switching the inner tab is this component's own
  // job; WorkflowRunsPanel only owns which run is selected within Runs.
  const pendingRunFocus = useAppStore((s) => s.pendingRunFocus)
  const consumePendingRunFocus = useAppStore((s) => s.consumePendingRunFocus)
  const focusRunId = workflow && pendingRunFocus?.workflowId === workflow.ID ? pendingRunFocus.runId : undefined

  useEffect(() => {
    if (focusRunId) setInnerTab('runs')
  }, [focusRunId])

  if (!workflow) {
    return <CompositionCanvas nodeTypes={nodeTypes} workflow={workflow} tabKey={tabKey} onBack={onBack} onSaved={onSaved} />
  }

  return (
    <Tabs value={innerTab} onValueChange={({ value }) => setInnerTab(value)}>
      <TabList aria-label={`${workflow.Label} sections`}>
        <TabItem value="canvas">Canvas</TabItem>
        <TabItem value="runs">Runs</TabItem>
        <TabItem value="versions">Versions</TabItem>
      </TabList>
      <TabPanel value="canvas" className={editorStyles.editorPanel}>
        <CompositionCanvas nodeTypes={nodeTypes} workflow={workflow} tabKey={tabKey} onBack={onBack} onSaved={onSaved} />
      </TabPanel>
      <TabPanel value="runs">
        <WorkflowRunsPanel workflowId={workflow.ID} initialRunId={focusRunId} onInitialRunConsumed={consumePendingRunFocus} />
      </TabPanel>
      <TabPanel value="versions">
        <WorkflowVersionsPanel workflow={workflow} onChanged={onWorkflowsChanged} />
      </TabPanel>
    </Tabs>
  )
}
