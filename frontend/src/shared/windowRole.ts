// Which window this bundle is currently rendering (ADR-0033): the main
// window and every auxiliary window (Quick Panel, tray panel, approval
// prompt, run monitor, capture) load the SAME compiled bundle at
// different hash routes, so the registry is importable everywhere --
// but a command that navigates has two different jobs depending on
// where it fires. Inside the main window it moves that window's own
// store; inside an auxiliary one it has to ask Go to bring the main
// window to the target instead (app/shared/navigateTarget.ts's
// grammar), because the auxiliary window has its own, separate store
// instance nothing renders the main shell from.
//
// The route list mirrors app/main.tsx's own branch -- one grammar, not
// two.
const AUXILIARY_ROUTES = ['#/quickpanel', '#/approvalprompt', '#/traypanel', '#/runmonitor', '#/capture']

export function isAuxiliaryWindow(): boolean {
  // No DOM at all means a unit run, never an auxiliary window -- this
  // leaf is imported by pure logic tests that have no window to read.
  if (typeof window === 'undefined') return false
  const hash = window.location.hash
  return AUXILIARY_ROUTES.some((route) => hash === route || hash.startsWith(`${route}?`))
}
