import { useEffect } from 'react'
import { Events } from '@wailsio/runtime'
import { useAppStore } from '../shared/store'
import type { View } from '../shared/store'
import { parseNavigateTarget } from '../shared/navigateTarget'

// docs/adr/0033: the Quick Panel's (and ApprovalPrompt's) "Open in
// Mill"/jump rows live in separate Wails windows with their own React
// trees -- they can't call setView directly, so they ask the main
// window to navigate via SettingsService.OpenMainWindow, which shows/
// focuses this window and emits 'mill-navigate'. Extracted out of
// App.tsx (CLAUDE.md's 500-line convention) since it's fully self-
// contained: one listener, one setView call, no other App.tsx state.
//
// Target strings: 'settings', 'review' (docs/goals/0023 item 1's
// ApprovalPrompt "Open in Mill" row), 'configure:<tab>' (goal 0015's
// remainder -- QuickPanel's Configure-entity jump rows land on the
// specific tab the entity lives in, e.g. 'configure:integration' for
// a connector, 'configure:lists' for a List, 'configure:mcpservers'
// for an MCP Server), 'atlas:<cardID>' (docs/goals/0061 item 6 --
// QuickPanel's card-search jump rows land on Atlas with that card's
// overlay open, AtlasView.tsx's own initialCardID prop resolves it to
// a viewed space). Empty string ('Open Mill') means "just show the
// window," no navigation -- OpenMainWindow only emits when non-empty.
export function useMillNavigate(setView: (view: View) => void): void {
  useEffect(() => {
    return Events.On('mill-navigate', (evt) => {
      const action = parseNavigateTarget(evt.data as string)
      if (!action) return
      if ('view' in action) setView(action.view)
      else useAppStore.getState().openWorkTab(action.workTab)
    })
  }, [setView])
}
