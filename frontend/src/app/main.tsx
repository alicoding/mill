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
// App is imported DYNAMICALLY inside bootstrap() below -- a static
// import would evaluate the whole app module graph (including the
// tool-registry snapshot) before the plugin loader has run. See
// src/plugins/loader.ts's boot-order contract.
import { AppErrorBoundary, CrashProbe } from './AppErrorBoundary'
// QuickPanelApp/ApprovalPromptApp are dynamic for the same boot-order
// reason as App: their own import graphs are deep enough to reach the
// tool-registry snapshot, and hand-auditing them forever is exactly
// the maintenance trap the dynamic import avoids structurally.
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

// The main window loads runtime plugins BEFORE the app module graph
// evaluates (docs/goals/0249): activation must precede the tool-list/
// command-table snapshots those modules take at eval. Raced against a
// deadline so a hung plugin import can never brick the boot -- the app
// then simply starts without the slow plugin, whose row shows the
// state. The auxiliary windows (Quick Panel, approval prompt, crash
// probe) render immediately -- none of them mounts a canvas.
async function bootstrap() {
  const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement)
  if (isCrashProbe || isQuickPanel || isApprovalPrompt) {
    const aux = isCrashProbe
      ? <CrashProbe />
      : isQuickPanel
        ? await import('./QuickPanelApp').then((m) => <m.QuickPanelApp />)
        : await import('./ApprovalPromptApp').then((m) => <m.ApprovalPromptApp />)
    root.render(
      <React.StrictMode>
        <AppErrorBoundary>{aux}</AppErrorBoundary>
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
  const { default: App } = await import('./App')
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
