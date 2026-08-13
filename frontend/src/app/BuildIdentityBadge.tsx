import { useTranslation } from 'react-i18next'
import { StatusStamp } from '../shared/StatusStamp'
import { SettingsService } from '../shared/bindings'
import type { BuildInfo } from '../shared/bindings'
import { useGoSourceStale } from './goLiveness'
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

// Third badge state (goal 0029, dev-liveness honesty): amber
// `DEV · go-stale` when Go source has moved since this binary was
// built but the rebuild hasn't landed yet -- the comparison logic and
// its own reasoning live in ./goLiveness (pulled out so it can be
// unit-tested without dragging @primer/react's CSS into Vitest).
export function BuildIdentityBadge({ buildInfo }: { buildInfo: BuildInfo | null }) {
  const { t } = useTranslation('app')
  // Go's own build tag (BuildInfo.Server), not a window-global sniff --
  // `'_wails' in window` is true in server-mode browser tabs too (the
  // runtime injects it everywhere), which silently broke this badge's
  // INSTALLED/SERVER split until goal 0021's dogfooding caught it.
  const isNativeWebview = buildInfo != null && !buildInfo.Server
  const binaryHead = buildInfo?.Revision ? buildInfo.Revision.slice(0, 7) : ''
  // Called unconditionally (rules of hooks) -- it no-ops outside a dev
  // build or before buildInfo has arrived, per its own guard.
  const goSourceStale = useGoSourceStale(buildInfo?.BuiltAt)

  // DEV wins over the stale comparison, deliberately (fixed 2026-08-11
  // after it false-alarmed on every commit): under `task dev`, vite
  // HMR IS the liveness guarantee, and __MILL_REPO_HEAD__ is baked ONCE
  // at vite startup (vite.config's git rev-parse) while the Go binary's
  // commit ADVANCES on every wails rebuild -- so committing during a
  // running `task dev` legitimately makes binary != bundle, which is
  // NOT staleness, just "committed forward since vite started." The
  // binary-vs-bundle comparison only means something for installed/
  // server builds, where `vite build` bakes the bundle at the SAME
  // commit as the binary. Dev-orphan windows are handled by prevention
  // now (the Taskfile pkill sweep, SPEC §3.8), not by this badge.
  if (isDevBuild) {
    // Third state (goal 0029): Go source has moved since this binary
    // was linked and no rebuild has landed within the grace window --
    // named remedy in both the visible label and the tooltip, since
    // amber (unlike green/red) isn't self-explanatory at a glance.
    if (goSourceStale) {
      return (
        <StatusStamp
          variant="caution" className={styles.devRibbon}
          data-testid="dev-go-stale-badge"
          title={t('buildIdentityBadge.goStaleTooltip')}
        >
          {t('buildIdentityBadge.devGoStale')}
        </StatusStamp>
      )
    }
    return (
      <StatusStamp variant="success" className={styles.devRibbon} data-testid="dev-build-badge">
        {t('buildIdentityBadge.devLive')}
      </StatusStamp>
    )
  }

  const buildStale = Boolean(binaryHead && __MILL_REPO_HEAD__ && binaryHead !== __MILL_REPO_HEAD__)

  if (buildStale) {
    // Inside the native webview the badge IS the action: one click quits
    // this stale instance (the fresh one is already running -- that's how
    // the bundle got newer). A server-mode browser tab only informs: it
    // must never kill the shared server.
    return isNativeWebview ? (
      <StatusStamp
        variant="danger"
        className={`${styles.devRibbon} ${styles.devRibbonAction}`}
        data-testid="stale-build-badge"
        onClick={() => { void SettingsService.QuitApp() }}
      >
        {t('buildIdentityBadge.staleBuildClickToClose', { binaryHead, repoHead: __MILL_REPO_HEAD__ })}
      </StatusStamp>
    ) : (
      <StatusStamp variant="danger" className={styles.devRibbon} data-testid="stale-build-badge">
        {t('buildIdentityBadge.staleBuildRestart', { binaryHead, repoHead: __MILL_REPO_HEAD__ })}
      </StatusStamp>
    )
  }

  if (isNativeWebview) {
    return (
      <StatusStamp variant="neutral" className={styles.devRibbon} data-testid="installed-build-badge">
        {t('buildIdentityBadge.installed')}{binaryHead ? ` · ${binaryHead}` : ''}
      </StatusStamp>
    )
  }

  return (
    <StatusStamp variant="neutral" className={styles.devRibbon} data-testid="server-build-badge">
      {t('buildIdentityBadge.server')}{binaryHead ? ` · ${binaryHead}` : ''}
    </StatusStamp>
  )
}
