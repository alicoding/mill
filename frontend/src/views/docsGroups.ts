// Pure derivation over DocsIndex: the sidebar's sections come from
// each page's kind (its front matter's `kind:`, carried on the index
// entry) in one fixed order -- what the reader is doing, not which
// directory the file sits in -- with two folder-defined exceptions:
// start-here/ is the ordered onboarding path whatever each page's own
// kind, and the agent pages keep a section of their own. The llms.txt
// generator publishes the same sections in the same order, so the
// human nav and the AI index can never disagree.

export interface DocsIndexEntry {
  rel: string
  title: string
  note: string
  kind: string
}

export interface DocsGroup {
  id: string
  titleKey: string
  entries: DocsIndexEntry[]
}

const START_HERE_GROUP = 'start-here'
const AGENTS_GROUP = 'agents'

// GROUP_ORDER is the fixed section order, keyed by page kind (plus the
// agents section), each with its views.json locale key.
const GROUP_ORDER: ReadonlyArray<{ id: string; titleKey: string }> = [
  { id: START_HERE_GROUP, titleKey: 'docs.sections.startHere' },
  { id: 'how-to', titleKey: 'docs.sections.howTo' },
  { id: 'explanation', titleKey: 'docs.sections.concepts' },
  { id: 'reference', titleKey: 'docs.sections.reference' },
  { id: AGENTS_GROUP, titleKey: 'docs.sections.agents' },
]

// groupOf names the section an entry belongs to: the onboarding path
// for anything under start-here/, the agents section for anything
// under agents/, its kind otherwise.
export function groupOf(entry: Pick<DocsIndexEntry, 'rel' | 'kind'>): string {
  if (entry.rel.startsWith('start-here/')) return START_HERE_GROUP
  if (entry.rel.startsWith('agents/')) return AGENTS_GROUP
  return entry.kind
}

// groupTitleKey resolves a section id to its locale key. An unknown id
// (a kind the index does not declare) returns an empty string -- the
// caller falls back to the raw id rather than rendering a missing
// translation.
export function groupTitleKey(id: string): string {
  return GROUP_ORDER.find((g) => g.id === id)?.titleKey ?? ''
}

// groupDocsIndex buckets entries into GROUP_ORDER's sections, each
// entry keeping its position in the source order; a section with no
// pages is omitted, and an entry whose kind matches no section lands
// in a trailing section of its own.
export function groupDocsIndex(entries: DocsIndexEntry[]): DocsGroup[] {
  const byId = new Map<string, DocsGroup>()
  for (const g of GROUP_ORDER) byId.set(g.id, { id: g.id, titleKey: g.titleKey, entries: [] })
  for (const entry of entries) {
    const id = groupOf(entry)
    let group = byId.get(id)
    if (!group) {
      group = { id, titleKey: '', entries: [] }
      byId.set(id, group)
    }
    group.entries.push(entry)
  }
  return [...byId.values()].filter((g) => g.entries.length > 0)
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
