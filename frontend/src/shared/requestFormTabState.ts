import type { StoreApi } from 'zustand'
import type { AppState } from './store'

// The Integration author form's Test action (goal 0370) -- split out of
// store.ts once this slice pushed it past the 500-line limit
// (.claude/rules/architecture.md), same "split along a real seam"
// discipline workTabs.ts already established for the work-tab types.
// Same store-signal-beats-a-callback-chain shape as store.ts's own
// canvasCommandRequest: shared/requestFormCommands.ts can't import
// configure/RequestForm.tsx directly (dependency-cruiser boundary,
// .claude/rules/frontend.md), so the command sets this signal instead,
// and only the mounted RequestForm whose own tabKey matches
// activeWorkTabKey consumes it (configure/useRequestFormTestDispatch.ts).
export interface RequestFormTabState {
  requestFormCommandRequest: 'test' | null
  requestRequestFormTest: () => void
  consumeRequestFormCommandRequest: () => void
  // Whether the active tab's own mounted RequestForm currently has
  // enough of a draft to test (its URL is non-empty), keyed by
  // WorkTab.key -- lets configure.integration.testDraft's enabled()
  // read the live draft without importing configure/RequestForm.tsx.
  // Cleared alongside workTabDirty by store.ts's own close paths.
  requestFormTestReady: Record<string, boolean>
  setRequestFormTestReady: (key: string, ready: boolean) => void
}

export function createRequestFormTabState(set: StoreApi<AppState>['setState']): RequestFormTabState {
  return {
    requestFormCommandRequest: null,
    requestRequestFormTest: () => set({ requestFormCommandRequest: 'test' }),
    consumeRequestFormCommandRequest: () => set({ requestFormCommandRequest: null }),
    requestFormTestReady: {},
    setRequestFormTestReady: (key, ready) =>
      set((state) => {
        if ((state.requestFormTestReady[key] ?? false) === ready) return {}
        return { requestFormTestReady: { ...state.requestFormTestReady, [key]: ready } }
      }),
  }
}
