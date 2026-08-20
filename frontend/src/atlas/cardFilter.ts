import type { Card, Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { Type as FieldType } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'

// The board filter's pure predicate (goal 0129 slice 1): the shared
// filter vocabulary the research verdict named -- text is the same
// case-insensitive substring over title+note the jump dialog
// established (atlasJumpFilter.ts), kinds are member-of-set, criteria
// AND together. Kept dependency-free like the jump filter so it's
// unit-testable without a store or a board.

export interface BoardFilter {
  query: string
  // Empty set = no kind criterion (every kind matches).
  kindIDs: Set<string>
  // Field key -> selected option values (goal 0129 slice 3). Values
  // within one field OR together; fields AND with each other and with
  // the criteria above. Empty map = no attribute criterion.
  fieldValues: Map<string, Set<string>>
}

export const EMPTY_BOARD_FILTER: BoardFilter = { query: '', kindIDs: new Set(), fieldValues: new Map() }

export function filterIsActive(f: BoardFilter): boolean {
  return f.query.trim() !== '' || f.kindIDs.size > 0 || f.fieldValues.size > 0
}

// matchesBoardFilter: true when the card satisfies EVERY active
// criterion. An inactive filter matches everything -- the board's
// resting state is "nothing dimmed".
export function matchesBoardFilter(card: Card, f: BoardFilter): boolean {
  if (f.kindIDs.size > 0 && !f.kindIDs.has(card.KindID)) return false
  for (const [key, values] of f.fieldValues) {
    // A card whose kind lacks the field, or whose value is unset,
    // doesn't satisfy the criterion -- it dims like any non-match.
    if (values.size > 0 && !values.has(card.Fields?.[key] ?? '')) return false
  }
  const q = f.query.trim().toLowerCase()
  if (q === '') return true
  return card.Title.toLowerCase().includes(q) || (card.Note ?? '').toLowerCase().includes(q)
}

// FacetField is one offerable attribute facet: an options-typed field
// declared by a kind on the board.
export interface FacetField {
  key: string
  label: string
  values: string[]
}

// facetFieldsFrom derives the offerable facets from the kinds present
// on the board. Field identity is the KEY: same-key options fields
// across kinds merge into one facet (label from the first declarer,
// values = ordered union) -- a shared "status" key filters across
// kinds instead of splitting into per-kind duplicates.
export function facetFieldsFrom(kinds: Kind[]): FacetField[] {
  const byKey = new Map<string, FacetField>()
  for (const kind of kinds) {
    for (const field of kind.Fields ?? []) {
      if (field.Type === FieldType.TypeOptions && field.Options?.length) {
        mergeFacetValues(byKey, field.Key, field.Label, field.Options)
      }
    }
  }
  return [...byKey.values()]
}

function mergeFacetValues(byKey: Map<string, FacetField>, key: string, label: string, options: string[]): void {
  const existing = byKey.get(key)
  if (!existing) {
    byKey.set(key, { key, label, values: [...options] })
    return
  }
  for (const v of options) {
    if (!existing.values.includes(v)) existing.values.push(v)
  }
}
