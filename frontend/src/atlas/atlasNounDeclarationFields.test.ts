import { describe, expect, it } from 'vitest'
import declarationFields from './atlasNounDeclarationFields.json'
import type { AtlasToolShape } from './atlasNounRegistry'

// This IS goal 0211's chosen freshness mechanism for
// userdocs/reference/extending-the-canvas.md's "What is required"
// table: internal/docsgen has no TypeScript parser, so the table is
// generated (by internal/docsgen's own Go test/gen step) from the
// small committed JSON this file imports -- and THIS test is the other
// half of that freshness chain, verifying the JSON stays exhaustive
// against the real registry type rather than drifting into a stale,
// separately hand-maintained field list.
//
// EXHAUSTIVE_FIELD_KEYS is a literal object, `satisfies`-checked
// against Record<keyof AtlasToolShape, true> -- TypeScript's own
// excess-property + missing-property checks (both only apply to a
// fresh object literal, never to an imported binding) make this
// object fail to COMPILE the moment AtlasToolShape gains, loses, or
// renames a member. `keyof AtlasToolShape` intersects the keys of
// every union member (they all share the same base fields plus id/
// interaction), so this needs no exported base interface to reach
// into.
const EXHAUSTIVE_FIELD_KEYS = {
  id: true,
  icon: true,
  label: true,
  shortcutKey: true,
  tray: true,
  interaction: true,
  styleDefaults: true,
  styleFields: true,
  lockable: true,
  resizable: true,
  boardNodeType: true,
  dragBand: true,
  fileBacked: true,
  boardObjectKind: true,
  content: true,
  commit: true,
  sticky: true,
  gesture: true,
} satisfies Record<keyof AtlasToolShape, true>

describe('atlasNounDeclarationFields.json (goal 0211: the extension contract page)', () => {
  it('documents exactly the fields AtlasToolShape actually has -- no more, no fewer', () => {
    const jsonFields = (declarationFields as { field: string }[]).map((f) => f.field).sort()
    const typeFields = Object.keys(EXHAUSTIVE_FIELD_KEYS).sort()
    expect(jsonFields).toEqual(typeFields)
  })

  it('gives every field a non-empty legalValues and meaning', () => {
    for (const entry of declarationFields as { field: string; legalValues: string; meaning: string }[]) {
      expect(entry.legalValues.length, `${entry.field}.legalValues`).toBeGreaterThan(0)
      expect(entry.meaning.length, `${entry.field}.meaning`).toBeGreaterThan(0)
    }
  })
})
