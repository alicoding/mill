// Pure client-side search over DocsSearchIndex (goal 0235 S2): the
// index is fetched once per session (DocsSearchDialog owns the fetch
// + cache), this module does only the matching/ranking/snippeting --
// no network, no DOM -- so it's unit-testable without mounting
// anything.

import type { DocSearchEntry } from '../shared/bindings'

export interface DocsSearchResult {
  rel: string
  title: string
  snippet: string
}

const SNIPPET_RADIUS = 60

function normalize(s: string): string {
  return s.toLowerCase()
}

// snippetAround extracts a short window of text centered on the first
// match of query inside text, ellipsis-padded on either truncated
// side -- the "short matched-context snippet" the picker's result row
// shows beneath the title.
function snippetAround(text: string, query: string): string {
  const at = normalize(text).indexOf(normalize(query))
  if (at === -1) return text.slice(0, SNIPPET_RADIUS * 2).trim()
  const start = Math.max(0, at - SNIPPET_RADIUS)
  const end = Math.min(text.length, at + query.length + SNIPPET_RADIUS)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''
  return prefix + text.slice(start, end).trim() + suffix
}

// searchDocs ranks title matches above body-only matches (a title hit
// is what the reader is almost always looking for), and within each
// tier preserves DocsIndex's own canonical order -- the same
// stable-sort property groupDocsIndex.ts's callers already rely on
// (Array.prototype.sort is a stable sort per the ECMAScript spec).
export function searchDocs(entries: DocSearchEntry[], query: string): DocsSearchResult[] {
  const q = query.trim()
  if (!q) return []
  const nq = normalize(q)
  const titleHits: DocsSearchResult[] = []
  const bodyHits: DocsSearchResult[] = []
  for (const e of entries) {
    const titleMatch = normalize(e.title).includes(nq)
    const bodyMatch = normalize(e.text).includes(nq)
    if (!titleMatch && !bodyMatch) continue
    const result: DocsSearchResult = {
      rel: e.rel,
      title: e.title,
      snippet: bodyMatch ? snippetAround(e.text, q) : '',
    }
    if (titleMatch) titleHits.push(result)
    else bodyHits.push(result)
  }
  return [...titleHits, ...bodyHits]
}
