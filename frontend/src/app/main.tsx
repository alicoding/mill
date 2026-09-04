import React from 'react'
import ReactDOM from 'react-dom/client'
import './i18n'
import './index.css'
import '@primer/primitives/dist/css/primitives.css'
// All fourteen functional themes @primer/primitives ships: the two
// defaults plus the accessible variants Settings offers as a color
// scheme per mode (goal 0320). dark-dimmed-high-contrast is imported
// though Settings never lists it -- it is Dimmed's high-contrast pair,
// reached when the OS asks for more contrast under Match system.
import '@primer/primitives/dist/css/functional/themes/light.css'
import '@primer/primitives/dist/css/functional/themes/light-high-contrast.css'
import '@primer/primitives/dist/css/functional/themes/light-colorblind.css'
import '@primer/primitives/dist/css/functional/themes/light-colorblind-high-contrast.css'
import '@primer/primitives/dist/css/functional/themes/light-tritanopia.css'
import '@primer/primitives/dist/css/functional/themes/light-tritanopia-high-contrast.css'
import '@primer/primitives/dist/css/functional/themes/dark.css'
import '@primer/primitives/dist/css/functional/themes/dark-dimmed.css'
import '@primer/primitives/dist/css/functional/themes/dark-dimmed-high-contrast.css'
import '@primer/primitives/dist/css/functional/themes/dark-high-contrast.css'
import '@primer/primitives/dist/css/functional/themes/dark-colorblind.css'
import '@primer/primitives/dist/css/functional/themes/dark-colorblind-high-contrast.css'
import '@primer/primitives/dist/css/functional/themes/dark-tritanopia.css'
import '@primer/primitives/dist/css/functional/themes/dark-tritanopia-high-contrast.css'
// AFTER Primer's own theme CSS, deliberately -- mill-tokens.css's own
// header comment has the full reasoning (a same-specificity override
// needs to win the cascade tie by load order here, not just win on
// paper via a selector-specificity trick that turned out to target
// the wrong element).
import './mill-tokens.css'
import App from './App'
import { AppErrorBoundary, CrashProbe } from './AppErrorBoundary'
import { QuickPanelApp } from './QuickPanelApp'
import { ApprovalPromptApp } from './ApprovalPromptApp'
import { TrayPanelApp } from './TrayPanelApp'
import { RunMonitorApp } from './RunMonitorApp'
import { AppearanceProvider } from './AppearanceProvider'

// docs/adr/0033-quick-panel-second-window.md: the Quick Panel is a
// second Wails window loading this SAME compiled bundle, at a hash
// route rather than a bare path -- production asset serving has no SPA
// fallback (confirmed directly), so a bare second path would 404 in a
// real installed build; a hash route never leaves the one
// already-served index.html. Branched once here, before the first
// render, rather than pulled into a router dependency neither window
// otherwise needs. Every shell -- this one and each auxiliary window --
// mounts AppearanceProvider itself (it is the theming shell, not a view
// inside <App/>'s tree), so the branch happens above that wrapper.
//
// The floating approval prompt (docs/goals/0023-attention-escalation.md
// item 1) reuses the exact same mechanism, a second hash route loading
// this same bundle -- ADR-0033's "the Quick Panel is now the reusable
// small-floating-second-window surface" consequence, applied.
const isQuickPanel = window.location.hash === '#/quickpanel'
const isApprovalPrompt = window.location.hash === '#/approvalprompt'
const isTrayPanel = window.location.hash === '#/traypanel'
// The run monitor carries its target in the hash query (RunMonitor.tsx).
const isRunMonitor = window.location.hash.startsWith('#/runmonitor')
// The capture window (goal 0309) carries its target in the hash query
// and, unlike the other auxiliary windows, LOADS plugins: a plugin's
// capture face renders here.
const isCapture = window.location.hash.startsWith('#/capture')
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
  if (isCapture) {
    await bootCapture(root)
    return
  }
  const auxiliary = auxiliaryApp()
  if (auxiliary) {
    root.render(
      <React.StrictMode>
        <AppErrorBoundary>{auxiliary}</AppErrorBoundary>
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
        <AppearanceProvider>
          <App />
        </AppearanceProvider>
      </AppErrorBoundary>
    </React.StrictMode>,
  )
}

void bootstrap()

// The capture window (goal 0309): plugins load here -- a plugin's
// capture face renders in this window -- under the same deadline the
// main window's boot uses, then the shell renders.
async function bootCapture(root: ReturnType<typeof ReactDOM.createRoot>) {
  const { loadPlugins } = await import('../plugins/loader')
  await Promise.race([
    loadPlugins().catch((err) => console.error('plugin loading failed', err)),
    new Promise((resolve) => window.setTimeout(resolve, 4000)),
  ])
  const { CaptureApp } = await import('./CaptureApp')
  root.render(
    <React.StrictMode>
      <CaptureApp />
    </React.StrictMode>,
  )
}

// The auxiliary windows' shells, one per hash route (none for the
// main window).
function auxiliaryApp() {
  if (isCrashProbe) return <CrashProbe />
  if (isQuickPanel) return <QuickPanelApp />
  if (isTrayPanel) return <TrayPanelApp />
  if (isRunMonitor) return <RunMonitorApp />
  if (isApprovalPrompt) return <ApprovalPromptApp />
  return null
}
