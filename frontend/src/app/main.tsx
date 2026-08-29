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
import { AppErrorBoundary, CrashProbe } from './AppErrorBoundary'
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
// The boundary's own e2e seam (AppErrorBoundary.tsx) -- a deliberate
// render crash at its own hash route, never reachable from normal UI.
const isCrashProbe = window.location.hash === '#/millcrashprobe'

// PWA installability (goal 0068): Chrome's install-prompt criteria
// require a registered service worker with a fetch handler (see
// public/service-worker.js's own comment for why it never caches) on
// top of the manifest link (index.html) and a secure-context origin --
// the documented mechanism is server mode reached over a tailnet's own
// HTTPS (`tailscale serve` + the tailnet's HTTPS certs), not something
// this app can provision itself. import.meta.env.PROD-gated so `task
// dev`'s hot-reload loop never has a service worker sitting between it
// and the Vite dev server.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/service-worker.js').catch(() => {})
  })
}

// The main window loads runtime plugins before the FIRST RENDER
// (docs/goals/0249): the module graph above evaluates statically (CSS
// cascade order and chunking stay exactly as before), and the
// registry snapshots those modules export are LAZY
// (shared/lazySnapshot.ts) -- they materialize on first access, which
// is always a render- or event-time read, after activation. Raced
// against a deadline so a hung plugin import can never brick the
// boot. The auxiliary windows render immediately -- none of them
// mounts a canvas.
async function bootstrap() {
  const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement)
  if (isCrashProbe || isQuickPanel || isApprovalPrompt) {
    root.render(
      <React.StrictMode>
        <AppErrorBoundary>{isCrashProbe ? <CrashProbe /> : isQuickPanel ? <QuickPanelApp /> : <ApprovalPromptApp />}</AppErrorBoundary>
      </React.StrictMode>,
    )
    return
  }
  const { loadPlugins } = await import('../plugins/loader')
  await Promise.race([
    loadPlugins().catch((err) => console.error('plugin loading failed', err)),
    new Promise((resolve) => window.setTimeout(resolve, 4000)),
  ])
  const { markPluginsSettled } = await import('../plugins/loadGate')
  markPluginsSettled()
  root.render(
    <React.StrictMode>
      <AppErrorBoundary>
        <ThemeProvider colorMode={initialColorMode}>
          <BaseStyles>
            <App />
          </BaseStyles>
        </ThemeProvider>
      </AppErrorBoundary>
    </React.StrictMode>,
  )
}

void bootstrap()
