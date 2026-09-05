import type { Command } from './commands'
import { useAppStore } from './store'

// The two halves of the workflow editor's mode switch (goal 0328). One
// open editor tab is either being read or being edited, and the header's
// segmented control renders exactly these two commands -- the selected
// segment is the mode already in force, so its own command is the
// disabled one. Split out of shared/canvasCommands.ts because that whole
// family is seated as one native-menu band (withMenuGroup), and these
// two belong beside Run in band 0 rather than among undo/redo/zoom.
//
// No default binding for either: a mode switch is a deliberate act with
// a permanent on-screen control, and every combo that reads as "edit"
// is already spoken for. The palette and the switch are the two doors.
function activeCanvasTabInMode(mode: 'view' | 'edit'): boolean {
  const { activeWorkTabKey, workTabs } = useAppStore.getState()
  return workTabs.some((t) => t.key === activeWorkTabKey && t.kind === 'workflow-edit' && t.mode === mode)
}

function switchActiveTabTo(mode: 'view' | 'edit'): void {
  const { activeWorkTabKey, setWorkTabMode } = useAppStore.getState()
  if (activeWorkTabKey) setWorkTabMode(activeWorkTabKey, mode)
}

export const WORKFLOW_MODE_COMMANDS: Command[] = [
  {
    id: 'workflow.view',
    label: 'commands.workflow.view',
    menu: { path: 'workflow', group: 0, order: 3 },
    defaultBinding: null,
    // A brand-new, never-saved workflow ('workflow-new') has nothing to
    // read back yet, so it is deliberately outside both predicates.
    enabled: () => activeCanvasTabInMode('edit'),
    run: () => switchActiveTabTo('view'),
  },
  {
    id: 'workflow.edit',
    label: 'commands.workflow.edit',
    menu: { path: 'workflow', group: 0, order: 4 },
    defaultBinding: null,
    // The active work tab is a workflow open read-only: the header's
    // Editing segment and every read-only reference field's Edit link
    // render this one command.
    enabled: () => activeCanvasTabInMode('view'),
    run: () => switchActiveTabTo('edit'),
  },
]
