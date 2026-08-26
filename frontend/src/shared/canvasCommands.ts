import type { Command } from './commands'
import { useAppStore } from './store'

// Canvas-authoring commands (docs/goals/0162 item 2): undo/redo/delete/
// zoom were toolbar-only, with no keyboard or palette reach -- split
// out of shared/commands.ts (CLAUDE.md's 500-line convention), same
// shape as shared/atlasBoardCommands.ts. Every entry is `surface:
// ['composition']`; each `run` sets the canvasCommandRequest signal
// (shared/store.ts) that the active CompositionCanvas's own
// useCanvasCommandDispatch consumes -- shared/ can't reach into a
// specific mounted canvas's zundo/React-Flow instance directly
// (dependency-cruiser boundary, .claude/rules/frontend.md), the same
// cross-tree-signal shape workflow.save/workflow.run already use.
//
// hintOnly on undo/redo/zoomIn/zoomOut/delete: the real keydown
// handling lives elsewhere, never dispatchCommandForEvent. Undo/redo/
// zoom are a dedicated, editable-target-guarded listener
// (app/useKeymapDispatch.ts) -- ⌘Z/⌘⇧Z collide with native text-undo
// the same way atlas.undoDelete's own ⌘Z does, and the other two ride
// the same listener so a shortcut can never move/resize the canvas out
// from under someone mid-edit either. Delete is React Flow's own
// deleteKeyCode default (CompositionCanvas.tsx), already
// editable-target-guarded upstream -- registering a second binding for
// it here would double-fire. Every entry still carries a real `run` so
// a palette click works even though a raw keypress never reaches
// dispatchCommandForEvent for it.
function requestCanvas(command: 'undo' | 'redo' | 'delete' | 'zoomIn' | 'zoomOut' | 'fitView' | 'publish') {
  useAppStore.getState().requestCanvasCommand(command)
}

export const CANVAS_COMMANDS: Command[] = [
  {
    id: 'canvas.undo',
    label: 'Undo',
    defaultBinding: { mods: ['cmd'], key: 'Z' },
    hintOnly: true,
    surface: ['composition'],
    run: () => requestCanvas('undo'),
  },
  {
    id: 'canvas.redo',
    label: 'Redo',
    defaultBinding: { mods: ['cmd', 'shift'], key: 'Z' },
    hintOnly: true,
    surface: ['composition'],
    run: () => requestCanvas('redo'),
  },
  {
    // Unreachable via keyboard by construction, same shape
    // atlas.delete.selection (shared/atlasBoardCommands.ts) already
    // established: a bare Delete/Backspace never carries Cmd/Ctrl, so
    // comboFromEvent (shared/keybinding.ts) can never produce a real
    // dispatch match here regardless of hintOnly -- both keys already
    // delete through React Flow's own deleteKeyCode prop
    // (CompositionCanvas.tsx), which independently guards editable
    // targets. This entry exists for HotkeyHint/Shortcuts-Help/palette
    // discoverability of that existing binding.
    id: 'canvas.delete',
    label: 'Delete selected',
    defaultBinding: { mods: [], key: 'Delete' },
    hintOnly: true,
    surface: ['composition'],
    run: () => requestCanvas('delete'),
  },
  {
    id: 'canvas.zoomIn',
    label: 'Zoom in',
    defaultBinding: { mods: ['cmd'], key: '+' },
    hintOnly: true,
    surface: ['composition'],
    run: () => requestCanvas('zoomIn'),
  },
  {
    id: 'canvas.zoomOut',
    label: 'Zoom out',
    defaultBinding: { mods: ['cmd'], key: '-' },
    hintOnly: true,
    surface: ['composition'],
    run: () => requestCanvas('zoomOut'),
  },
  {
    // No default keyboard binding: ⌘0 is already view.home's own
    // global shortcut (shared/commands.ts). Unlike a surface-scoped
    // command that's always valid on its surface (atlas.jump legally
    // overriding palette.open's ⌘K while on Atlas), fit-view has no
    // meaningful action outside an actual open canvas tab -- claiming
    // ⌘0 the same way would make Home unreachable by keyboard from the
    // plain Workflows list too, not just from inside a canvas. Toolbar
    // (React Flow's own Controls) and the palette stay its entry
    // points.
    id: 'canvas.fitView',
    label: 'Fit view',
    defaultBinding: null,
    surface: ['composition'],
    run: () => requestCanvas('fitView'),
  },
  {
    // The Versions tab's "Publish current draft" button
    // (composition/WorkflowVersionsPanel.tsx, goal 0222 S1) -- same
    // canvasCommandRequest signal seam as every command above (shared/
    // can't reach into a specific mounted tab directly). Only a SAVED
    // workflow's editor has a Versions tab to publish from, so this is
    // enabled on a narrower condition than commands.ts's own
    // isWorkflowEditorTabActive: the active work tab must be a
    // 'workflow-edit' tab specifically (carries workflowId), never a
    // not-yet-saved 'workflow-new' one.
    id: 'workflow.publish',
    label: 'Publish current draft',
    defaultBinding: null,
    surface: ['composition'],
    enabled: () => {
      const { activeWorkTabKey, workTabs } = useAppStore.getState()
      return workTabs.some((t) => t.key === activeWorkTabKey && t.kind === 'workflow-edit')
    },
    run: () => requestCanvas('publish'),
  },
]
