import { useEffect } from 'react'
import type { RefObject } from 'react'
import { useAppStore } from '../shared/store'
import type { RunButtonHandle } from './LiveRunControls'
import type { CanvasStore } from './canvasStore'

// Consumes the keymap system's workflow.save/workflow.run/canvas.*
// commands (docs/goals/0016-keymap-system.md, shared/commands.ts;
// docs/goals/0162 item 2 for undo/redo/delete/zoom) for ONE mounted
// CompositionCanvas tab -- split out of CompositionCanvas.tsx once that
// file crossed the 500-line limit (.claude/rules/architecture.md), zero
// behavior change. shared/commands.ts can't call into a specific canvas
// directly (it can't import composition/ at all, .claude/rules/frontend.md's
// boundary rule), so every one of these commands instead sets a
// store-level canvasCommandRequest signal; every open canvas tab stays
// mounted-hidden (docs/SPEC.md §3.8), so each one runs this hook and
// only the tab whose tabKey matches the currently ACTIVE work tab
// actually acts -- every other mounted canvas sees the identical store
// update and ignores it.
//
// runButtonRef lets 'run' reuse RunButton's own attrs-check-then-
// dialog-or-immediate-run logic (LiveRunControls.tsx) instead of a
// second copy of it here. canvasActions bundles the rest (undo/redo via
// the mounted canvas's own zundo temporal store, delete via the exact
// function the toolbar's own Trash button already calls, zoom/fit via
// this canvas's own useReactFlow instance) so every one of these ends
// up calling the SAME underlying function the toolbar does, never a
// second, divergent code path.
export interface CanvasCommandActions {
  useCanvasStore: CanvasStore
  removeSelected: () => void
  zoomIn: () => void
  zoomOut: () => void
  fitView: () => void
}

export function useCanvasCommandDispatch(
  tabKey: string,
  save: () => void | Promise<void>,
  runButtonRef: RefObject<RunButtonHandle | null>,
  canvasActions: CanvasCommandActions,
) {
  const canvasCommandRequest = useAppStore((s) => s.canvasCommandRequest)
  const consumeCanvasCommandRequest = useAppStore((s) => s.consumeCanvasCommandRequest)
  const activeWorkTabKey = useAppStore((s) => s.activeWorkTabKey)

  useEffect(() => {
    if (!canvasCommandRequest) return
    if (activeWorkTabKey !== tabKey) return
    if (canvasCommandRequest === 'save') {
      void save()
    } else if (canvasCommandRequest === 'run') {
      runButtonRef.current?.trigger()
    } else if (canvasCommandRequest === 'undo') {
      canvasActions.useCanvasStore.temporal.getState().undo()
    } else if (canvasCommandRequest === 'redo') {
      canvasActions.useCanvasStore.temporal.getState().redo()
    } else if (canvasCommandRequest === 'delete') {
      canvasActions.removeSelected()
    } else if (canvasCommandRequest === 'zoomIn') {
      canvasActions.zoomIn()
    } else if (canvasCommandRequest === 'zoomOut') {
      canvasActions.zoomOut()
    } else if (canvasCommandRequest === 'fitView') {
      canvasActions.fitView()
    }
    consumeCanvasCommandRequest()
    // save/runButtonRef/canvasActions/consumeCanvasCommandRequest
    // deliberately excluded: save and canvasActions are fresh
    // closures/objects every render (neither is memoized upstream), and
    // re-running this effect on every render just because one of their
    // identities changed would risk double-consuming a request
    // mid-render; canvasCommandRequest/activeWorkTabKey/tabKey are the
    // real triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasCommandRequest, activeWorkTabKey, tabKey])
}
