import type { Command } from './commands'
import type { CommandContext, CommandContextKind } from './commandContext'
import { useAppStore } from './store'
import { atlasSelectionEmpty, atlasSelectionContext, useAtlasSelectionStore } from './atlasSelectionStore'

// ambientContext resolves the target the user is currently looking at,
// for the two invokers that have no row to point at: the window keydown
// dispatcher and the command palette (goal 0343). A row surface never
// calls this -- it supplies its own row's context directly.
//
// Two sources, both store state, in precedence order:
//  1. The active work tab, when it is a workflow editor -- the same
//     "which workflow does a keystroke mean" answer workflow.save and
//     workflow.run already resolve (isWorkflowEditorTabActive).
//  2. The Atlas board's live selection (shared/atlasSelectionStore.ts,
//     goal 0346 slice B), when Atlas is the active view and something
//     is selected -- the same target a right-click menu on that
//     selection hands its own items.
//  3. The Atlas view's own viewed card (View's `cardID`), when Atlas is
//     the active view, nothing is selected, and it is on a card rather
//     than a board.
//
// There is deliberately NO ambient run or clipboard entry: the selected
// run is WorkflowRunsPanel's component state and the selected clipboard
// entry is ClipboardHistoryDialog's, neither reachable from this
// dependency-cruiser leaf. Commands declaring needs:'run'/'entry'
// therefore never surface in the palette -- a row hands them their
// target instead, which is exactly the model.
// The kinds ambientContext() below can ever resolve. A command needing
// any OTHER kind is reachable only from a surface that hands it the
// target -- a row, a menu on that row -- never from a keystroke or the
// palette, both of which have only this function to ask.
export const AMBIENT_CONTEXT_KINDS: CommandContextKind[] = ['workflow', 'selection', 'card']

// Whether a keystroke could ever reach this command: the keydown
// dispatcher supplies ambientContext() and nothing else, so binding a
// command that needs a target it can't resolve would silently do
// nothing. Settings' rebind list excludes those for the same reason it
// excludes hintOnly commands (goal 0346).
export function isKeyboardDispatchable(command: Pick<Command, 'needs' | 'hintOnly'>): boolean {
  if (command.hintOnly) return false
  return !command.needs || AMBIENT_CONTEXT_KINDS.includes(command.needs)
}

export function ambientContext(): CommandContext | undefined {
  const { activeWorkTabKey, workTabs, view } = useAppStore.getState()
  const active = workTabs.find((t) => t.key === activeWorkTabKey)
  if (active?.kind === 'workflow-edit') return { kind: 'workflow', workflowId: active.workflowId }
  if (view.kind === 'atlas' && !atlasSelectionEmpty(useAtlasSelectionStore.getState())) return atlasSelectionContext()
  if (view.kind === 'atlas' && view.cardID) return { kind: 'card', cardId: view.cardID }
  return undefined
}
