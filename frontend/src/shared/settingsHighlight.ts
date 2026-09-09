import { settingById } from './settingsRegistry'
import { useAppStore } from './store'
import { useUISignalStore } from './uiSignalStore'

// Jump-and-highlight (goal 0412 S2 design contract item 3): the shared
// destination for BOTH triggers that can land on one setting -- a
// search result's own selection (views/SettingsGroupNav.tsx) and a
// `settings.show.<id>` palette command (shared/settingsCommands.ts).
// One function, not two copies, keeps "navigate, then highlight" a
// single behavior regardless of where the setting was found.

export const SETTINGS_HIGHLIGHT_MS = 2000

// Amendment 1 (installed-app pass): a row whose control depends on an
// async fetch (SettingsShortcutsPane's summon-hotkey lookup, e.g.)
// swaps its subtree, or flips a control from disabled to enabled, once
// that fetch resolves -- focusing too early either unmounts the
// focused element (focus drops to <body>) or focuses a disabled node
// (a no-op). `data-setting-ready` on the row (SettingsRow.tsx's own
// `ready` prop) names when that's settled; `"false"` while loading,
// `"true"` once resolved, ABSENT for a row with no async dependency
// (read as always-ready). Never longer than the highlight itself stays
// lit -- focusing a control after its own highlight already faded
// would be a surprising, disconnected action.
const READY_FALLBACK_MS = SETTINGS_HIGHLIGHT_MS

// A row's own interactive control never has a stable, non-hashed
// selector to query from outside its own CSS module -- SettingsRow.tsx
// marks its control wrapper with this plain data attribute instead
// (goal 0412 S2), so this file's own DOM query doesn't need to import
// SettingsRow's CSS module just to read a class name back out of it.
const FOCUSABLE_SELECTOR = 'input, textarea, select, button, [href], [contenteditable="true"], [tabindex]:not([tabindex="-1"])'

function settingRow(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-setting-id="${id}"]`)
}

function isRowReady(row: HTMLElement): boolean {
  const ready = row.getAttribute('data-setting-ready')
  return ready === null || ready === 'true'
}

function focusRowControl(row: HTMLElement): void {
  const controlWrap = row.querySelector<HTMLElement>('[data-setting-control]')
  const focusable = controlWrap?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ?? controlWrap
  focusable?.focus()
}

// focusRowWhenReady focuses immediately when the row is already ready;
// otherwise it watches `data-setting-ready` for the false -> true flip
// via a MutationObserver -- no timer guessing at fetch latency -- with
// a READY_FALLBACK_MS bound so a row whose data never resolves (or
// takes unusually long) still ends up focused on whatever control
// exists, rather than never moving at all. Returns a cancel function:
// a NEW jump superseding this one, or the owning component unmounting,
// calls it so a late flip never reaches into a discarded jump.
function focusRowWhenReady(row: HTMLElement): () => void {
  if (isRowReady(row)) {
    focusRowControl(row)
    return () => {}
  }
  let settled = false
  const observer = new MutationObserver(() => {
    if (isRowReady(row)) finish()
  })
  function finish(): void {
    if (settled) return
    settled = true
    observer.disconnect()
    window.clearTimeout(fallback)
    focusRowControl(row)
  }
  observer.observe(row, { attributes: true, attributeFilter: ['data-setting-ready'] })
  const fallback = window.setTimeout(finish, READY_FALLBACK_MS)
  return () => {
    if (settled) return
    settled = true
    observer.disconnect()
    window.clearTimeout(fallback)
  }
}

// jumpAndHighlightSetting scrolls a RENDERED setting row into view and
// applies `highlightClass` immediately -- factored out of the React
// effect that calls it (views/useSettingsHighlight.ts) so a Vitest
// case can drive it against a bare jsdom fixture, no React tree
// required. FOCUS is handed to focusRowWhenReady above; its cancel
// function comes back as `cancelFocusWait` for the caller to invoke on
// supersede/unmount. `found` is false when the id names a real setting
// whose pane hasn't rendered its row yet (the caller's own effect is
// what waits for that render before calling this).
export function jumpAndHighlightSetting(id: string, highlightClass: string): { found: boolean; cancelFocusWait: () => void } {
  const row = settingRow(id)
  if (!row) return { found: false, cancelFocusWait: () => {} }
  row.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  row.classList.add(highlightClass)
  return { found: true, cancelFocusWait: focusRowWhenReady(row) }
}

// Review finding (goal 0412 S2): a registry entry's row can be
// CONDITIONALLY ABSENT, not merely loading -- SettingsExtensionPolicy.tsx's
// six security.extension* rows only render at all once the org policy
// is confirmed managed and error-free, so `jumpAndHighlightSetting`
// above finds nothing on the first attempt whenever that data is still
// in flight. waitForSettingRow bridges that gap the same
// MutationObserver-plus-bound shape focusRowWhenReady already uses,
// scoped to `document.body` since the row's OWN container doesn't
// exist yet to observe directly. Bounded by ROW_WAIT_MS so a setting
// that will never render in the current state (an unmanaged policy)
// still resolves to `null` rather than watching forever.
const ROW_WAIT_MS = SETTINGS_HIGHLIGHT_MS

export function waitForSettingRow(id: string, onFound: (row: HTMLElement) => void, onTimeout: () => void): () => void {
  const existing = settingRow(id)
  if (existing) {
    onFound(existing)
    return () => {}
  }
  let settled = false
  const observer = new MutationObserver(() => {
    const row = settingRow(id)
    if (row) finish(() => onFound(row))
  })
  function finish(action: () => void): void {
    if (settled) return
    settled = true
    observer.disconnect()
    window.clearTimeout(fallback)
    action()
  }
  observer.observe(document.body, { childList: true, subtree: true })
  const fallback = window.setTimeout(() => finish(onTimeout), ROW_WAIT_MS)
  return () => {
    if (settled) return
    settled = true
    observer.disconnect()
    window.clearTimeout(fallback)
  }
}

// clearSettingHighlight removes a highlight this file itself applied --
// called both by the caller's own timeout (SETTINGS_HIGHLIGHT_MS
// elapsed) and immediately when a NEW jump supersedes a still-active
// one ("removed on timeout or on the next navigation", design contract
// item 3). A row that has since unmounted (the user navigated away by
// hand) is simply absent -- classList removal on a live element only.
export function clearSettingHighlight(id: string, highlightClass: string): void {
  settingRow(id)?.classList.remove(highlightClass)
}

// jumpToSetting resolves a registry id to its owning group, navigates
// there (mounting Settings first if it isn't already the active view),
// and raises the highlight request the destination's own
// useSettingsHighlight effect consumes once that group's pane has
// actually rendered the row. Silently ignores an unknown id -- both
// callers (a ranked search result, a `settings.show.<id>` command) can
// only ever pass a real registry id in practice, but neither is worth
// throwing over a stale one.
export function jumpToSetting(id: string): void {
  const entry = settingById(id)
  if (!entry) return
  useAppStore.getState().setView({ kind: 'settings', section: entry.group })
  useUISignalStore.getState().requestSettingsHighlight(id)
}
