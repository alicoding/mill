import { ThemeProvider, BaseStyles } from '@primer/react'
import { ApprovalPrompt } from './ApprovalPrompt'
import { COLOR_MODE_STORAGE_KEY } from './theme'

// docs/goals/0023-attention-escalation.md item 1: the dedicated shell
// for the floating approval prompt's own Wails window (loaded at the
// '#/approvalprompt' hash route, main.tsx) -- same shape as
// QuickPanelApp (ADR-0033), deliberately minimal, no PageLayout/
// sidebar/work-tab-strip chrome. Reads the same persisted color-mode
// preference App.tsx's theme switcher writes so this window matches
// whatever the user last chose, rather than defaulting to 'auto'
// independently of it.
export function ApprovalPromptApp() {
  const initialColorMode = (localStorage.getItem(COLOR_MODE_STORAGE_KEY) as 'light' | 'dark' | 'auto' | null) ?? 'auto'
  return (
    <ThemeProvider colorMode={initialColorMode}>
      <BaseStyles>
        <ApprovalPrompt />
      </BaseStyles>
    </ThemeProvider>
  )
}
