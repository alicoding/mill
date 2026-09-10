import type { WhenFacts } from './whenClause'
import { mergePluginContext } from './pluginContextKeys'
import { useAtlasSelectionStore } from '../shared/atlasSelectionStore'

// The facts a declared menu item's `when` clause is written against
// (docs/goals/0380 Decision 4). This list IS the author-facing
// vocabulary, so it is enumerated in one place and derived from what
// Mill's own object menu already tests -- the object's kind, whether
// it has a file behind it, which door edits it, how much is selected
// -- rather than invented ahead of a need.
//
// An undeclared fact reads as absent, so an item written against a
// fact a later Mill drops stays hidden instead of taking the menu
// down.
//
// Every fact set below is merged with the CALLING plugin's own context
// keys (goal 0349 S2c Decision 2, mergePluginContext): a plugin's own
// `plugin.<key>` facts, with Mill's own facts spread last so nothing a
// plugin sets can ever shadow one of Mill's.

export interface BoardObjectMenuInput {
  kind: string
  payload: Record<string, string>
  size: { W: number; H: number } | null
  /** The extension that owns this object's kind, '' for a built-in. */
  pluginId: string
  /** True when the object is file-backed and its file is on disk. */
  hasFile: boolean
  /** Which door edits the object: 'inline', 'external-app' or 'none'. */
  editRoute: string
  selectionKinds: readonly string[]
}

// boardObjectMenuFacts is the canvas context menu's fact set. Payload
// keys arrive under a `payload.` prefix so an author can test the
// object's own data ("payload.shapeType == 'arrow'") without a fact
// name ever colliding with one of Mill's.
export function boardObjectMenuFacts(input: BoardObjectMenuInput): WhenFacts {
  const facts: Record<string, string | number | boolean | readonly string[]> = {
    seat: 'canvasContextMenu',
    objectKind: input.kind,
    objectPluginId: input.pluginId,
    hasFile: input.hasFile,
    hasSize: input.size !== null,
    editRoute: input.editRoute,
    selectionCount: input.selectionKinds.length,
    selectionKinds: input.selectionKinds,
  }
  for (const [key, value] of Object.entries(input.payload)) facts[`payload.${key}`] = value
  return mergePluginContext(facts, input.pluginId)
}

// viewTitleMenuFacts is the work tab's fact set: which view's title bar
// the item is being seated on, so one extension with several views can
// scope an item to one of them.
export function viewTitleMenuFacts(pluginId: string, viewId: string): WhenFacts {
  return mergePluginContext({ seat: 'viewTitle', viewId, selectionCount: 0, selectionKinds: [] }, pluginId)
}

// factsNow is the seat-INDEPENDENT fact set a framed command's own
// generic `enabled()` evaluates a declared item's `when` against (goal
// 0349 S2c Decision 3): there is no right-clicked object or open tab
// anchoring this evaluation the way a seat's own fact set has one, so
// only the board's ambient selection COUNT is answered (no per-object
// kind lookup without pulling the atlas objects store into this leaf)
// -- plus the calling plugin's own context keys, exactly as every
// seat's fact set carries them.
export function factsNow(pluginId: string): WhenFacts {
  const sel = useAtlasSelectionStore.getState()
  const selectionCount = sel.cards.length + sel.notes.length + sel.objects.length + sel.links.length
  return mergePluginContext({ selectionCount }, pluginId)
}
