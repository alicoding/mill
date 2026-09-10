// The port a selection command reads the board's DATA through (goal
// 0346 slice B). shared/atlasSelectionStore.ts carries ids; whether a
// card mirrors a file, which exporters it declares, whether an object's
// noun offers an embedded editor -- those live in atlas/'s own store
// and noun registry, which this dependency-cruiser leaf can never
// import. atlas/atlasSelectionFactsProvider.ts installs the one adapter
// at module load, the same install-a-resolver seam shared/copy.ts uses
// for i18next. Before install (a unit test, module eval) every lookup
// answers "unknown", so every selection command reads as unavailable
// rather than acting on a guess.

export interface AtlasCardFacts {
  id: string
  title: string
  // The card's own Source string, what "Copy link" writes.
  source: string
  mirrorPath: boolean
  // Holds children (cards, notes or objects) -- renders as a frame.
  isGroup: boolean
  // A List projection table, whose box is its rows, not free text.
  projection: boolean
  // Root-level: the card IS a space.
  root: boolean
  // A mirror/list backing "Turn back into object" can hand back
  // unchanged (goal 0410 Decision 3) -- true for a List projection or
  // an image/drawio/mermaid mirror, false for every other card
  // (plain, markdown, PDF, ...) that has nothing to demote to.
  demotable: boolean
  exporters: { format: string; label: string }[]
}

export interface AtlasObjectFacts {
  id: string
  kind: string
  rename: boolean
  openInDefaultApp: boolean
  editDiagram: boolean
  fitDiagram: boolean
  // A plugin's own items for this object's kind, already filtered by
  // their enabled predicate (goal 0280).
  pluginItems: { id: string; label: string }[]
  // What a DECLARED menu item's `when` clause is evaluated against
  // (docs/goals/0380 Decision 4). Names and meanings live in one place
  // -- plugins/pluginMenuFacts.ts -- since they are author-facing
  // vocabulary, not an internal shape.
  menuFacts: Readonly<Record<string, string | number | boolean | null | readonly (string | number | boolean | null)[]>>
}

export interface AtlasLinkFacts {
  id: string
  sourceId: string
  sourceTitle: string
  targetId: string
  targetTitle: string
  label: string
}

export interface AtlasPerspectiveFacts {
  id: string
  name: string
  members: string[]
}

export interface AtlasFacts {
  card: (id: string) => AtlasCardFacts | undefined
  note: (id: string) => boolean
  object: (id: string) => AtlasObjectFacts | undefined
  link: (id: string) => AtlasLinkFacts | undefined
  linkKinds: () => { id: string; label: string }[]
  perspectives: () => AtlasPerspectiveFacts[]
}

const UNKNOWN: AtlasFacts = {
  card: () => undefined,
  note: () => false,
  object: () => undefined,
  link: () => undefined,
  linkKinds: () => [],
  perspectives: () => [],
}

let installed: AtlasFacts = UNKNOWN

export function installAtlasFacts(facts: AtlasFacts): void {
  installed = facts
}

// Test-only reset, mirroring copy.ts's resetCopyResolver.
export function resetAtlasFacts(): void {
  installed = UNKNOWN
}

export function atlasFacts(): AtlasFacts {
  return installed
}
