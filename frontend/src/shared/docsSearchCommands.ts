import type { Command } from './commands'
import { useUISignalStore } from './uiSignalStore'

// docs.search (goal 0235 S2): always enabled -- the picker fetches
// and caches the embedded docs index itself (app/DocsSearchDialog.tsx),
// nothing about app state gates it. Reachable from any view (not
// surface-scoped to 'docs'): a reader who doesn't already have the
// Docs surface open is exactly who needs a fast way in. No default
// binding, same "discoverable via the palette, freely reassignable"
// convention as view.docs/clipboard.history.open -- split out of
// shared/commands.ts (CLAUDE.md's 500-line convention).
export const DOCS_SEARCH_COMMANDS: Command[] = [
  {
    id: 'docs.search',
    label: 'commands.docs.search',
    defaultBinding: null,
    run: () => useUISignalStore.getState().openDocsSearch(),
  },
]
