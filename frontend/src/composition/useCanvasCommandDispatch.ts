import { useEffect } from 'react'
import type { RefObject } from 'react'
import { useAppStore } from '../shared/store'
import type { RunButtonHandle } from './LiveRunControls'

// Consumes the keymap system's workflow.save/workflow.run commands
// (docs/goals/0016-keymap-system.md, shared/commands.ts) for ONE
// mounted CompositionCanvas tab -- split out of CompositionCanvas.tsx
// once that file crossed the 500-line limit
// (.claude/rules/architecture.md), zero behavior change. shared/
// commands.ts can't call into a specific canvas directly (it can't
// import composition/ at all, .claude/rules/frontend.md's boundary
// rule), so workflow.save/run instead set a store-level
// canvasCommandRequest signal; every open canvas tab stays
// mounted-hidden (docs/SPEC.md §3.8), so each one runs this hook and
// only the tab whose tabKey matches the currently ACTIVE work tab
// actually acts -- every other mounted canvas sees the identical store
// update and ignores it.
//
// runButtonRef lets 'run' reuse RunButton's own attrs-check-then-
// dialog-or-immediate-run logic (LiveRunControls.tsx) instead of a
// second copy of it here.
export function useCanvasCommandDispatch(
  tabKey: string,
  save: () => void | Promise<void>,
  runButtonRef: RefObject<RunButtonHandle | null>,
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
    }
    consumeCanvasCommandRequest()
    // save/runButtonRef/consumeCanvasCommandRequest deliberately excluded:
    // save is a fresh closure every render (it isn't memoized upstream),
    // and re-running this effect on every render just because `save`'s
    // identity changed would risk double-consuming a request mid-render;
    // canvasCommandRequest/activeWorkTabKey/tabKey are the real triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasCommandRequest, activeWorkTabKey, tabKey])
}
