import { ApprovalPrompt } from './ApprovalPrompt'
import { AppearanceProvider } from './AppearanceProvider'

// docs/goals/0023-attention-escalation.md item 1: the dedicated shell
// for the floating approval prompt's own Wails window (loaded at the
// '#/approvalprompt' hash route, main.tsx) -- same shape as
// QuickPanelApp (ADR-0033), deliberately minimal, no PageLayout/
// sidebar/work-tab-strip chrome, under the shared appearance shell.
export function ApprovalPromptApp() {
  return (
    <AppearanceProvider>
      <ApprovalPrompt />
    </AppearanceProvider>
  )
}
