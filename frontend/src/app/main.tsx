import React from 'react'
import ReactDOM from 'react-dom/client'
import './i18n'
import './index.css'
import '@primer/primitives/dist/css/primitives.css'
import '@primer/primitives/dist/css/functional/themes/light.css'
import '@primer/primitives/dist/css/functional/themes/dark.css'
// AFTER Primer's own theme CSS, deliberately -- mill-tokens.css's own
// header comment has the full reasoning (a same-specificity override
// needs to win the cascade tie by load order here, not just win on
// paper via a selector-specificity trick that turned out to target
// the wrong element).
import './mill-tokens.css'
import { ThemeProvider, BaseStyles } from '@primer/react'
import App from './App'
import { QuickPanelApp } from './QuickPanelApp'
import { ApprovalPromptApp } from './ApprovalPromptApp'
import { COLOR_MODE_STORAGE_KEY } from './theme'

// Read once, synchronously, before the first render, to seed
// ThemeProvider's initial colorMode -- not the ongoing value. App.tsx's
// theme switcher changes it afterward via Primer's own useTheme() hook;
// this constant never changes across re-renders (it's read once, here,
// at module load), so it only ever acts as an initial value and never
// fights the user's later choice. Confirmed directly against
// ThemeProvider's own implementation: it seeds a useSyncedState from
// this prop and only re-syncs when the *prop itself* changes between
// renders, which it never does here.
const initialColorMode = (localStorage.getItem(COLOR_MODE_STORAGE_KEY) as 'light' | 'dark' | 'auto' | null) ?? 'auto'

// docs/adr/0033-quick-panel-second-window.md: the Quick Panel is a
// second Wails window loading this SAME compiled bundle, at a hash
// route rather than a bare path -- production asset serving has no SPA
// fallback (confirmed directly), so a bare second path would 404 in a
// real installed build; a hash route never leaves the one
// already-served index.html. Branched once here, before the first
// render, rather than pulled into a router dependency neither window
// otherwise needs. QuickPanelApp owns its own ThemeProvider/BaseStyles
// (it's a separate, minimal shell, not a view inside <App/>'s tree) --
// so the branch happens above that wrapper, not inside a shared one.
//
// The floating approval prompt (docs/goals/0023-attention-escalation.md
// item 1) reuses the exact same mechanism, a second hash route loading
// this same bundle -- ADR-0033's "the Quick Panel is now the reusable
// small-floating-second-window surface" consequence, applied.
const isQuickPanel = window.location.hash === '#/quickpanel'
const isApprovalPrompt = window.location.hash === '#/approvalprompt'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {isQuickPanel ? (
      <QuickPanelApp />
    ) : isApprovalPrompt ? (
      <ApprovalPromptApp />
    ) : (
      <ThemeProvider colorMode={initialColorMode}>
        <BaseStyles>
          <App />
        </BaseStyles>
      </ThemeProvider>
    )}
  </React.StrictMode>,
)
