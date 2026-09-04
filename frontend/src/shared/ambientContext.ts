import type { CommandContext } from './commandContext'
import { useAppStore } from './store'

// ambientContext resolves the target the user is currently looking at,
// for the two invokers that have no row to point at: the window keydown
// dispatcher and the command palette (goal 0343). A row surface never
// calls this -- it supplies its own row's context directly.
//
// Two sources, both store state, in precedence order:
//  1. The active work tab, when it is a workflow editor -- the same
//     "which workflow does a keystroke mean" answer workflow.save and
//     workflow.run already resolve (isWorkflowEditorTabActive).
//  2. The Atlas view's own viewed card (View's `cardID`), when Atlas is
//     the active view and it is on a card rather than a board.
//
// There is deliberately NO ambient run or clipboard entry: the selected
// run is WorkflowRunsPanel's component state and the selected clipboard
// entry is ClipboardHistoryDialog's, neither reachable from this
// dependency-cruiser leaf. Commands declaring needs:'run'/'entry'
// therefore never surface in the palette -- a row hands them their
// target instead, which is exactly the model.
export function ambientContext(): CommandContext | undefined {
  const { activeWorkTabKey, workTabs, view } = useAppStore.getState()
  const active = workTabs.find((t) => t.key === activeWorkTabKey)
  if (active?.kind === 'workflow-edit') return { kind: 'workflow', workflowId: active.workflowId }
  if (view.kind === 'atlas' && view.cardID) return { kind: 'card', cardId: view.cardID }
  return undefined
}
