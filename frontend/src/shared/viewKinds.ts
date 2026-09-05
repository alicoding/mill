import { ViewKind } from '../../bindings/github.com/alicoding/mill/internal/domain/capabilities/models'
import type { Capability } from '../../bindings/github.com/alicoding/mill/internal/domain/capabilities/models'

// Which page the app is on, and the two derivations over it -- split
// out of shared/store.ts at the 500-line limit (CLAUDE.md), along the
// seam store.ts's own workTabs.ts split already established. store.ts
// re-exports all three, so no call site changed.

// Discriminated union, not a plain string id: 'placeholder' always
// carries which capability it's standing in for, so PlaceholderView never
// has to guess or fall back to a default.
export type View =
  | { kind: 'home' }
  | { kind: 'activity' }
  | { kind: 'review' }
  | { kind: 'composition' }
  // tab: which ConfigureView sub-tab to land on; undefined keeps every
  // existing `{ kind: 'configure' }` call site on its own last tab.
  | { kind: 'configure'; tab?: string }
  // cardID: a card-search jump opens that card's overlay directly.
  | { kind: 'atlas'; cardID?: string }
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
