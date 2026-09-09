import { ViewKind } from '../../bindings/github.com/alicoding/mill/internal/domain/capabilities/models'
import type { Capability } from '../../bindings/github.com/alicoding/mill/internal/domain/capabilities/models'

// Which page the app is on, and the two derivations over it -- split
// out of shared/store.ts at the 500-line limit (CLAUDE.md), along the
// seam store.ts's own workTabs.ts split already established. store.ts
// re-exports all three, so no call site changed.

// Discriminated union, not a plain string id: 'placeholder' always
// carries which capability it's standing in for, so PlaceholderView never
// has to guess or fall back to a default.
// Which of the ways of looking at an Atlas space is active (goal 0355
// S2): the canvas itself, the one built-in projection (List), or a
// plugin-contributed view ('plugin:<pluginId>.<viewId>' -- goal 0357,
// Matrix/Coverage/Roadmap all included since goal 0357 S2) -- panes in
// the board's own content region the view switcher swaps in place.
// Declared in shared/ (not atlas/): it is a field OF the persisted
// View union below, and shared/ may not import from atlas/.
export type AtlasBoardView = 'board' | 'list' | `plugin:${string}`

// legacyBoardViewMigrations is the ONE table every legacy persisted
// literal maps through (goal 0357 S2): 'roadmap'/'matrix'/'coverage'
// were their own core projections' literals before each became a
// bundled plugin's pane, so a stored value from before that move maps
// onto the plugin's pane id here -- one table, never three code paths.
const legacyBoardViewMigrations: Record<string, `plugin:${string}`> = {
  roadmap: 'plugin:mill-roadmap.roadmap',
  matrix: 'plugin:mill-matrix.matrix',
  coverage: 'plugin:mill-coverage.coverage',
}

// normalizeAtlasBoardView is the ONE read-side mapping persisted board
// views pass through (goal 0357). Unknown values fall back to the
// Board rather than stranding the window on a pane nothing renders.
export function normalizeAtlasBoardView(raw: string | undefined): AtlasBoardView {
  if (raw !== undefined && raw in legacyBoardViewMigrations) return legacyBoardViewMigrations[raw]
  if (raw === 'list') return raw
  if (raw !== undefined && raw.startsWith('plugin:')) return raw as AtlasBoardView
  return 'board'
}

// parsePluginBoardView splits the 'plugin:<pluginId>.<viewId>' form a
// plugin-contributed pane persists as (goal 0357); null for a core
// view. The plugin id holds no dot, so the first dot splits the pair.
export function parsePluginBoardView(view: AtlasBoardView): { pluginId: string; viewId: string } | null {
  if (!view.startsWith('plugin:')) return null
  const rest = view.slice('plugin:'.length)
  const dot = rest.indexOf('.')
  if (dot === -1) return null
  return { pluginId: rest.slice(0, dot), viewId: rest.slice(dot + 1) }
}

export type View =
  | { kind: 'home' }
  | { kind: 'activity' }
  | { kind: 'review' }
  | { kind: 'composition' }
  // tab: which ConfigureView sub-tab to land on; undefined keeps every
  // existing `{ kind: 'configure' }` call site on its own last tab.
  | { kind: 'configure'; tab?: string }
  // cardID: a card-search jump opens that card's overlay directly.
  // boardView: the active projection pane (goal 0355 S2); undefined is
  // the Board canvas. Carried by the persisted view so a reloaded window
  // and a work-tab round trip both land back on the same view.
  | { kind: 'atlas'; cardID?: string; boardView?: AtlasBoardView }
  // section: a palette "Open Settings -> <Title>" deep-link
  // (shared/settingsSections.ts) lands directly on that section.
  | { kind: 'settings'; section?: string }
  // page: which docs page is open (rel path from the docs index).
  | { kind: 'docs'; page?: string }
  // tab: which Secrets section to land on -- 'vault' (the entries) or
  // 'sources' (the stores Mill reads entries from). Undefined lands on
  // the vault.
  | { kind: 'secrets'; tab?: string }
  // tab: which Extensions tab to land on -- 'installed', 'browse' or
  // 'updates'. Undefined lands on Installed.
  | { kind: 'extensions'; tab?: string }
  | { kind: 'placeholder'; capabilityId: string }

// Single mapping from a capability's Go-declared View to the frontend's
// own View union -- shared by the sidebar nav so it navigates
// consistently instead of re-deriving this per call site.
export function viewFor(capability: Capability): View {
  switch (capability.View) {
    case ViewKind.ViewHome:
      return { kind: 'home' }
    case ViewKind.ViewActivity:
      return { kind: 'activity' }
    case ViewKind.ViewReview:
      return { kind: 'review' }
    case ViewKind.ViewComposition:
      return { kind: 'composition' }
    case ViewKind.ViewConfigure:
      return { kind: 'configure' }
    case ViewKind.ViewDocs:
      return { kind: 'docs' }
    case ViewKind.ViewAtlas:
      return { kind: 'atlas' }
    case ViewKind.ViewSecrets:
      return { kind: 'secrets' }
    case ViewKind.ViewExtensions:
      return { kind: 'extensions' }
    default:
      return { kind: 'placeholder', capabilityId: capability.ID }
  }
}

export function viewsEqual(a: View, b: View): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'placeholder' && b.kind === 'placeholder') return a.capabilityId === b.capabilityId
  return true
}
