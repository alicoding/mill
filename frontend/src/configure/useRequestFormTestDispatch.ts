import { useEffect } from 'react'
import type { RefObject } from 'react'
import { useAppStore } from '../shared/store'
import type { RequestTestPanelHandle } from './RequestTestPanel'

// Consumes configure.integration.testDraft (shared/requestFormCommands.ts)
// for ONE mounted RequestForm tab -- shared/ can't import configure/
// directly (dependency-cruiser boundary), so the command instead sets a
// store-level requestFormCommandRequest signal (shared/requestFormTabState.ts);
// every open request tab stays mounted-hidden (docs/SPEC.md §3.8), so
// each one runs this hook and only the tab whose tabKey matches the
// currently active work tab actually triggers its own test panel --
// every other mounted RequestForm sees the identical store update and
// ignores it. Same shape as composition/useCanvasCommandDispatch.ts.
export function useRequestFormTestDispatch(tabKey: string, testPanelRef: RefObject<RequestTestPanelHandle | null>) {
  const requestFormCommandRequest = useAppStore((s) => s.requestFormCommandRequest)
  const consumeRequestFormCommandRequest = useAppStore((s) => s.consumeRequestFormCommandRequest)
  const activeWorkTabKey = useAppStore((s) => s.activeWorkTabKey)

  useEffect(() => {
    if (!requestFormCommandRequest) return
    if (activeWorkTabKey !== tabKey) return
    testPanelRef.current?.trigger()
    consumeRequestFormCommandRequest()
    // testPanelRef/consumeRequestFormCommandRequest deliberately
    // excluded: the ref is a stable object identity and re-running this
    // effect just because the store's own action-function identity
    // changed would risk double-consuming a request mid-render, the
    // same reasoning useCanvasCommandDispatch's own effect documents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestFormCommandRequest, activeWorkTabKey, tabKey])
}
