import { Label } from '@primer/react'
import { SettingsService } from '../shared/bindings'
import type { BuildInfo } from '../shared/bindings'
import styles from './App.module.css'

// Extracted from App.tsx along the 500-line seam (goal 0019). ONE rule
// for the owner: a green "DEV · live" means trust this window; anything
// else means it is NOT the live dev build. The recurring confusion this
// fixes (docs/goals/0019-build-freshness-clarity.md): the old badge only
// compared the frontend bundle to the Go binary (internal consistency),
// so a matching INSTALLED .app rendered nothing at all and could
// masquerade as current -- exactly how the owner kept mistaking the
// stale /Applications/Mill.app for the live build. So every artifact now
// self-identifies:
//   - task dev (import.meta.env.DEV, i.e. vite serve): the frontend is
//     Vite-HMR-live and Go auto-rebuilds on save, so it is up to date BY
//     CONSTRUCTION -- a green "DEV · live", never a hash to decode, never
//     a false "behind HEAD" alarm on a docs/Taskfile commit.
//   - installed .app (native webview, production bundle): a neutral
//     "INSTALLED · <commit>", ALWAYS shown, so it can never be mistaken
//     for the live build.
//   - server mode (not a webview): "SERVER · <commit>".
// buildStale (bundle commit != binary commit) stays the loud red
// exception for the genuine orphaned-window case (a fresh bundle answered
// by an old binary -- docs/SPEC.md §3.8).
const isDevBuild = import.meta.env.DEV

export function BuildIdentityBadge({ buildInfo }: { buildInfo: BuildInfo | null }) {
  // Go's own build tag (BuildInfo.Server), not a window-global sniff --
  // `'_wails' in window` is true in server-mode browser tabs too (the
  // runtime injects it everywhere), which silently broke this badge's
  // INSTALLED/SERVER split until goal 0021's dogfooding caught it.
  const isNativeWebview = buildInfo != null && !buildInfo.Server
  const binaryHead = buildInfo?.Revision ? buildInfo.Revision.slice(0, 7) : ''
  const buildStale = Boolean(binaryHead && __MILL_REPO_HEAD__ && binaryHead !== __MILL_REPO_HEAD__)

  if (buildStale) {
    // Inside the native webview the badge IS the action: one click quits
    // this stale instance (the fresh one is already running -- that's how
    // the bundle got newer). A server-mode browser tab only informs: it
    // must never kill the shared server.
    return isNativeWebview ? (
      <Label
        variant="danger" size="small"
        className={`${styles.devRibbon} ${styles.devRibbonAction}`}
        data-testid="stale-build-badge"
        onClick={() => { void SettingsService.QuitApp() }}
      >
        STALE BUILD · app {binaryHead} ≠ repo {__MILL_REPO_HEAD__} — click to close this stale window
      </Label>
    ) : (
      <Label variant="danger" size="small" className={styles.devRibbon} data-testid="stale-build-badge">
        STALE BUILD · app {binaryHead} ≠ repo {__MILL_REPO_HEAD__} — restart task dev
      </Label>
    )
  }

  if (isDevBuild) {
    return (
      <Label variant="success" size="small" className={styles.devRibbon} data-testid="dev-build-badge">
        DEV · live
      </Label>
    )
  }

  if (isNativeWebview) {
    return (
      <Label variant="secondary" size="small" className={styles.devRibbon} data-testid="installed-build-badge">
        INSTALLED{binaryHead ? ` · ${binaryHead}` : ''}
      </Label>
    )
  }

  return (
    <Label variant="secondary" size="small" className={styles.devRibbon} data-testid="server-build-badge">
      SERVER{binaryHead ? ` · ${binaryHead}` : ''}
    </Label>
  )
}
