// Pure derivation over DocsIndex (goal 0235 S1): DocsIndexEntry carries
// no group field (internal/services/docssvc's DocsIndexEntry is flat --
// Rel/Title/Note), so the sidebar's section grouping is derived here
// from each entry's rel path prefix, in the index's own canonical
// order -- the same order the llms.txt generator publishes, so the
// human nav and the AI index can never disagree.

export interface DocsIndexEntry {
  rel: string
  title: string
  note: string
}

export interface DocsGroup {
  dir: string
  titleKey: string
  entries: DocsIndexEntry[]
}

// SECTION_TITLE_KEYS maps a userdocs/ top-level directory to its
// views.json locale key. A directory outside this closed set (none
// exist today) falls back to its raw name via sectionTitleFallback.
const SECTION_TITLE_KEYS: Record<string, string> = {
  'start-here': 'docs.sections.startHere',
  concepts: 'docs.sections.concepts',
  reference: 'docs.sections.reference',
  agents: 'docs.sections.agents',
  trust: 'docs.sections.trust',
}

// Exported for app/DocsSearchDialog.tsx's own result rows (goal 0235
// S2: "page title + section name + snippet") -- the same derivation
// groupDocsIndex uses internally.
export function dirOf(rel: string): string {
  const slash = rel.indexOf('/')
  return slash === -1 ? '' : rel.slice(0, slash)
}

// sectionTitleKey resolves a directory to its locale key. Unknown
// directories return an empty string -- the caller falls back to the
// raw directory name rather than rendering a missing translation.
export function sectionTitleKey(dir: string): string {
  return SECTION_TITLE_KEYS[dir] ?? ''
}

// groupDocsIndex buckets entries by their rel path's top-level
// directory, preserving each entry's position in the source order --
// section order is therefore whichever section's first page appears
// earliest in DocsIndex, matching the canonical reading order.
export function groupDocsIndex(entries: DocsIndexEntry[]): DocsGroup[] {
  const groups: DocsGroup[] = []
  const byDir = new Map<string, DocsGroup>()
  for (const entry of entries) {
    const dir = dirOf(entry.rel)
    let group = byDir.get(dir)
    if (!group) {
      group = { dir, titleKey: sectionTitleKey(dir), entries: [] }
      byDir.set(dir, group)
      groups.push(group)
    }
    group.entries.push(entry)
  }
  return groups
}

export interface AdjacentPages {
  prev?: DocsIndexEntry
  next?: DocsIndexEntry
}

// adjacentPages derives the prev/next footer pair from the FLAT
// DocsIndex order (not the grouped view) -- reading order already
// crosses section boundaries, so prev/next does too.
export function adjacentPages(entries: DocsIndexEntry[], currentRel: string): AdjacentPages {
  const index = entries.findIndex((e) => e.rel === currentRel)
  if (index === -1) return {}
  return {
    prev: index > 0 ? entries[index - 1] : undefined,
    next: index < entries.length - 1 ? entries[index + 1] : undefined,
  }
}
