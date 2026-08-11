// Pure query-matching for the ⌘K command palette
// (docs/goals/0015-summon-quick-invoke.md). The goal itself says plain
// substring matching is fine ("fuzzy-ish... plain substring across
// label+keywords"), so this deliberately isn't a real fuzzy/scored
// matcher (no new dependency, nothing to adopt-vs-build here per
// .claude/rules/architecture.md -- a few hundred entries never needs
// one) -- just a stable prefix-then-contains partition, which is
// enough to keep an exact/near-exact match (e.g. typing a workflow's
// full first word) ranked above an incidental mid-string hit.
//
// Kept as a standalone pure function, co-located with its only caller
// (app/CommandPalette.tsx) rather than promoted to shared/ --
// .claude/rules/frontend.md's own placement rule ("a file used by
// exactly one caller belongs in that caller's own folder, not
// preemptively promoted"). Exported + unit-tested per
// .claude/rules/testing.md so the ranking behavior has real coverage
// beyond only ever being exercised through the live Dialog.

export interface PaletteSearchable {
  // Precomputed, already-lowercased haystack (e.g. `${label} ${id}`)
  // -- built once per entry at render time, not re-derived per
  // keystroke inside this function.
  searchText: string
}

// Empty/whitespace-only query returns every entry, unranked (the
// palette's own "browse everything" state before typing anything).
// A non-empty query keeps only entries whose searchText contains it,
// with prefix matches ordered before mid-string matches; relative
// order within each bucket is preserved (Array.prototype.filter/push
// is stable), so a group's own original ordering (registry order for
// commands, alphabetical for workflows, open-order for tabs) still
// holds among equally-ranked matches.
export function filterPaletteEntries<T extends PaletteSearchable>(entries: T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return entries
  const prefixMatches: T[] = []
  const containsMatches: T[] = []
  for (const entry of entries) {
    const at = entry.searchText.indexOf(q)
    if (at === -1) continue
    if (at === 0) prefixMatches.push(entry)
    else containsMatches.push(entry)
  }
  return [...prefixMatches, ...containsMatches]
}
