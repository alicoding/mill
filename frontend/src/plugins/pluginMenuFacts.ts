import type { WhenFacts } from './whenClause'

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
  return facts
}

// viewTitleMenuFacts is the work tab's fact set: which view's title bar
// the item is being seated on, so one extension with several views can
// scope an item to one of them.
export function viewTitleMenuFacts(viewId: string): WhenFacts {
  return { seat: 'viewTitle', viewId, selectionCount: 0, selectionKinds: [] }
}
