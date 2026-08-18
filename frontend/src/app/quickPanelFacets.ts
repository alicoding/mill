import { useMemo, type RefObject } from 'react'
import { filterPaletteEntries } from './paletteFilter'
import { matchFacetSuggestions, parseFacetQuery } from '../shared/facetQuery'
import type { FacetVocabEntry } from '../shared/facetQuery'
import type { PanelEntry } from './quickPanelActionEntries'

// Split out of QuickPanel.tsx (architecture.md's 500-line convention),
// same seam quickPanelActionEntries.tsx was split along: the panel's
// own faceted-search vocabulary (goal 0086) is a pure derivation from
// the entry shapes quickPanelActionEntries.tsx already builds, with no
// hook state of its own.
//
// Vocabulary is "workflow" plus one keyword per Configure entity type
// this panel actually renders as jump rows (quickPanelActionEntries.tsx's
// own `configure:<tab>:<id>` id shape drives the match below). 'atlas'
// and 'actions' stay unscoped on purpose -- Atlas cards already have
// their own dedicated jump surface (atlas/AtlasJumpDialog.tsx), and
// 'actions' is a handful of fixed rows with nothing worth narrowing.
export function facetVocabularyFor(t: (key: string) => string): FacetVocabEntry[] {
  return [
    { key: 'workflow', label: t('quickPanel.facets.workflow') },
    { key: 'integration', label: t('quickPanel.facets.integration') },
    { key: 'list', label: t('quickPanel.facets.list') },
    { key: 'mcpServer', label: t('quickPanel.facets.mcpServer') },
    { key: 'decision', label: t('quickPanel.facets.decision') },
    { key: 'execEnv', label: t('quickPanel.facets.execEnv') },
    { key: 'aiProvider', label: t('quickPanel.facets.aiProvider') },
    { key: 'stepType', label: t('quickPanel.facets.stepType') },
  ]
}

const CONFIGURE_TAB_BY_FACET: Record<string, string> = {
  integration: 'integration',
  list: 'lists',
  mcpServer: 'mcpservers',
  decision: 'decisions',
  execEnv: 'execenvs',
  aiProvider: 'aiproviders',
  stepType: 'steptypes',
}

function matchesPanelFacet(scopeKey: string, entry: PanelEntry): boolean {
  if (scopeKey === 'workflow') return entry.groupId === 'workflows'
  const tab = CONFIGURE_TAB_BY_FACET[scopeKey]
  return tab ? entry.id.startsWith(`configure:${tab}:`) : true
}

// The scope-then-rank pipeline QuickPanel.tsx's own filtered-entries
// step delegates to (same shape app/CommandPalette.tsx runs inline) --
// pulled into a hook so QuickPanel.tsx's render body stays a single
// call instead of five separate useMemos (architecture.md's 500-line
// convention).
export function useQuickPanelFacetSearch(params: {
  t: (key: string) => string
  allEntries: PanelEntry[]
  query: string
  setQuery: (query: string) => void
  inputRef: RefObject<HTMLInputElement | null>
}): { filtered: PanelEntry[]; chipSuggestions: FacetVocabEntry[]; selectChip: (key: string) => void } {
  const { t, allEntries, query, setQuery, inputRef } = params
  const facetVocab = useMemo(() => facetVocabularyFor(t), [t])
  const parsed = useMemo(() => parseFacetQuery(query, facetVocab), [query, facetVocab])
  const chipSuggestions = useMemo(
    () => (parsed.scopeKey || !query.trim() ? [] : matchFacetSuggestions(query, facetVocab)),
    [parsed.scopeKey, query, facetVocab],
  )
  const scopedEntries = useMemo(
    () => (parsed.scopeKey ? allEntries.filter((e) => matchesPanelFacet(parsed.scopeKey!, e)) : allEntries),
    [allEntries, parsed.scopeKey],
  )
  const filtered = filterPaletteEntries(scopedEntries, parsed.text)

  const selectChip = (key: string) => {
    const entry = facetVocab.find((v) => v.key === key)
    if (!entry) return
    setQuery(`${entry.label}: `)
    inputRef.current?.focus()
  }

  return { filtered, chipSuggestions, selectChip }
}
