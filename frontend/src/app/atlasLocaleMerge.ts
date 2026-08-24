// Merges Atlas's per-noun locale/*.json modules (goal 0180 slice 2)
// into the single flat object i18next loads as the 'atlas' namespace --
// see i18n.ts's own header for why the FILE splits but the namespace
// never does.
//
// THE TRAP: most of atlas.json's top-level keys are nested objects
// (pencilStyle, board, overlay, ...). A naive `{ ...a, ...b, ...c }`
// spread CLOBBERS an entire subtree the instant two files declare the
// same top-level key -- silently, and last-write-wins. This merge
// refuses that outcome instead: every top-level key across the merged
// files must be unique, checked before any value is copied, so two
// files can never silently overwrite each other's subtree.
export function mergeAtlasLocaleModules(modules: Record<string, Record<string, unknown>>): Record<string, unknown> {
  const merged: Record<string, unknown> = {}
  const ownerOf = new Map<string, string>()
  // Sorted so the reported owner pair is deterministic regardless of
  // the glob's own filesystem enumeration order.
  const entries = Object.entries(modules).sort(([a], [b]) => a.localeCompare(b))
  for (const [path, contents] of entries) {
    for (const [key, value] of Object.entries(contents)) {
      const existingOwner = ownerOf.get(key)
      if (existingOwner !== undefined) {
        throw new Error(`atlas locale key "${key}" is declared in both ${existingOwner} and ${path} -- each locales/en/atlas/*.json file must own disjoint top-level keys`)
      }
      ownerOf.set(key, path)
      merged[key] = value
    }
  }
  return merged
}
