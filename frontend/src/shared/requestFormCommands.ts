import type { Command } from './commands'
import { useAppStore } from './store'

// The Integration author form's Test action (goal 0370, ADR-0014's
// on-form-Test amendment) -- split out of shared/commands.ts (CLAUDE.md's
// 500-line convention), same shape as shared/canvasCommands.ts: shared/
// can't import configure/RequestForm.tsx directly (dependency-cruiser
// boundary, .claude/rules/frontend.md), so run() sets the store-level
// requestFormCommandRequest signal (shared/requestFormTabState.ts);
// only the mounted RequestForm whose own tabKey matches the active work
// tab consumes it (configure/useRequestFormTestDispatch.ts).
export const REQUEST_FORM_COMMANDS: Command[] = [
  {
    id: 'configure.integration.testDraft',
    label: 'commands.configure.integration.testDraft',
    defaultBinding: null,
    // Mirrors the URL-non-empty gate the form's own Test button disables
    // on -- requestFormTestReady is written only by the active tab's own
    // RequestForm (goal 0370's design contract item 4), so an inactive
    // or non-request tab always reads as unready.
    enabled: () => {
      const { activeWorkTabKey, requestFormTestReady } = useAppStore.getState()
      return Boolean(activeWorkTabKey && requestFormTestReady[activeWorkTabKey])
    },
    run: () => useAppStore.getState().requestRequestFormTest(),
  },
]
