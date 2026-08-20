// Column-key derivation for the projection table's one-click
// "+ Column" (goal 0105 part 2): keys are slugs of the label, unique
// within the List (ADR-0040 makes a saved key immutable, so the
// derivation must never collide with an existing one).
export function nextColumnKey(label: string, existing: string[]): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'column'
  if (!existing.includes(base)) return base
  let n = 2
  while (existing.includes(`${base}-${n}`)) n++
  return `${base}-${n}`
}
