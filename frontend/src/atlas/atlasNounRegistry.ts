import type { ComponentType } from 'react'
import type { Icon } from '@primer/octicons-react'
import { ATLAS_TOOL_IDENTITIES, type AtlasToolIdentity, type AtlasToolInteraction } from '../shared/atlasToolIdentity'

// The frontend twin of composition/registry.go's RegisterNodeType
// (ADR-0006, goal 0180 slice 1): each canvas noun's own fat descriptor
// (icon, style picker, commit path) lives in its own
// frontend/src/atlas/tools/<id>Tool.ts file and calls registerNoun()
// at module-eval time -- atlasTools.ts discovers every one of them via
// import.meta.glob(..., { eager: true }) rather than holding a literal
// array every noun is appended to.
export type { AtlasToolInteraction }

// Session-only cache seeding a newly created object's own style
// (colour/size, ...) -- never persisted document data.
export type AtlasToolStyleDefaults = Record<string, unknown>

interface AtlasToolShapeBase {
  icon: Icon
  label: string
  shortcutKey: string | null
  tray: 'quick' | 'palette'
  styleDefaults?: AtlasToolStyleDefaults
  // The tray's own options-bar component, shown anchored to this tool's
  // button for as long as it's armed (AtlasCreationTray.tsx's own
  // 'drag-to-draw' branch renders whichever tool carries one) --
  // registry-driven so a second drag-to-draw tool never needs a
  // hardcoded branch naming it by id.
  StylePicker?: ComponentType
  // Each concrete tool's own commit signature differs (a card commits
  // kind+title, a table mints a backing List); this base only has to
  // accept every one of them for the registry's own element type to
  // work, never call through it generically.
  commit: (input: never) => unknown
}

// AtlasToolShape: a discriminated union, one member per
// shared/atlasToolIdentity.ts entry, correlating id<->interaction the
// same way the pre-registry hand-written ATLAS_TOOLS tuple did --
// mapped MECHANICALLY over AtlasToolIdentity['id'] (never over a
// per-noun file list), so a consumer that narrows on `interaction`
// (AtlasCreationTray.tsx discriminates its drag-to-draw/pick-then-
// place/paste-or-drop tray branches) can still read a correlated,
// literal `id` back out afterwards. A plain `{ id: string; interaction:
// AtlasToolInteraction }` shape would satisfy every individual noun
// file fine but silently stop narrowing at every CONSUMER of the
// runtime ATLAS_TOOLS array -- the same "collapses to string, invisible
// until something misroutes" trap one level down (see atlasTools.ts's
// own header for the top-level version).
export type AtlasToolShape = {
  [ID in AtlasToolIdentity['id']]: AtlasToolShapeBase & {
    id: ID
    interaction: Extract<AtlasToolIdentity, { id: ID }>['interaction']
  }
}[AtlasToolIdentity['id']]

const registry = new Map<string, AtlasToolShape>()

// registerNoun -- called once, at module-eval time, from each noun's
// own tools/<id>Tool.ts. Throws on a duplicate id so two files can
// never silently overwrite each other's registration.
export function registerNoun(descriptor: AtlasToolShape): void {
  if (registry.has(descriptor.id)) {
    throw new Error(`atlas noun "${descriptor.id}" registered twice -- check frontend/src/atlas/tools/`)
  }
  registry.set(descriptor.id, descriptor)
}

// identityOf -- the one lookup every noun's own descriptor file uses to
// source its id/shortcutKey/label/interaction from
// shared/atlasToolIdentity.ts rather than restating them.
export function identityOf<ID extends AtlasToolIdentity['id']>(id: ID): Extract<AtlasToolIdentity, { id: ID }> {
  const found = ATLAS_TOOL_IDENTITIES.find((t): t is Extract<AtlasToolIdentity, { id: ID }> => t.id === id)
  if (!found) throw new Error(`no atlas tool identity registered for "${id}"`)
  return found
}

// The agreement check (goal 0180 S1's own conformance mechanism, and
// goal 0181's first concrete instance): every identity in
// shared/atlasToolIdentity.ts must have exactly one registered
// descriptor, and every registered descriptor must have a matching
// identity. Called from atlasTools.ts once every tools/*.ts module has
// been eagerly imported, so a noun that half-exists on either side
// fails at module-eval time (surfacing in every test/dev/build that
// imports atlasTools.ts) instead of silently misrouting at runtime.
export function assertRegistryAgreesWithIdentity(): void {
  const identityIDs = ATLAS_TOOL_IDENTITIES.map((i) => i.id)
  for (const id of identityIDs) {
    if (!registry.has(id)) {
      throw new Error(`atlas noun "${id}" has an identity (shared/atlasToolIdentity.ts) but no registered descriptor -- add frontend/src/atlas/tools/${id}Tool.ts calling registerNoun()`)
    }
  }
  for (const id of registry.keys()) {
    if (!identityIDs.includes(id as AtlasToolIdentity['id'])) {
      throw new Error(`atlas noun "${id}" registered a descriptor (frontend/src/atlas/tools/) but has no identity in shared/atlasToolIdentity.ts`)
    }
  }
}

// orderedRegisteredTools -- ATLAS_TOOLS' own tray render order comes
// from ATLAS_TOOL_IDENTITIES (declared once, in the order the tray
// renders), never from Map insertion order (which would follow
// import.meta.glob's own alphabetical file-path sort and silently
// reorder the tray the next time a noun's filename changes).
export function orderedRegisteredTools(): AtlasToolShape[] {
  return ATLAS_TOOL_IDENTITIES.map((i) => {
    const found = registry.get(i.id)
    if (!found) throw new Error(`atlas noun "${i.id}" missing its registered descriptor`)
    return found
  })
}
