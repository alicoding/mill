import type { Command } from './commands'
import { useUISignalStore } from './uiSignalStore'

// codingLoop.run (docs/goals/0240 S1): the capture entry point --
// palette + keyboard-assignable in the main window (opens
// app/CodingLoopDialog.tsx via the uiSignalStore signal below); Quick
// Panel renders its OWN bespoke row for the same action
// (app/quickPanelActionEntries.tsx's QUICK_PANEL_RICH_ROW_ORDER), with
// its own panel-local run wiring (app/useQuickPanelCodingLoopDoor.ts) --
// same split clipboard.history.open/panel.applyClipboard already
// establish between a shared registry entry and each window's own
// door. No default binding: discoverable via the palette and freely
// keyboard-assignable in Settings > Keyboard Shortcuts, same as
// clipboard.history.open.
export const CODING_LOOP_COMMANDS: Command[] = [
  {
    id: 'codingLoop.run',
    menu: { path: 'workflow', group: 0, order: 1 },
    label: 'commands.codingLoop.run',
    defaultBinding: null,
    quickPanel: true,
    run: () => useUISignalStore.getState().openCodingLoop(),
  },
]
