// Persists the set of open, saved-entity tab identities (+ which was
// active) across restarts -- docs/SPEC.md §3.7's Update, the concrete
// "open tabs" half of the navigational-state gap. Shared by
// CompositionView.tsx and ConfigureIntegration.tsx, whose EditorTab/
// RequestTab shapes are already near-identical by design (the latter
// explicitly "mirrors CompositionView.tsx's own EditorTab/tabs/
// activeTab shape exactly," docs/adr/0014) -- one small helper here
// instead of two copies.
//
// Deliberately persists only entity IDs, never a tab's own ephemeral
// `key` (regenerated fresh via crypto.randomUUID() on every restore)
// and never a "new"/"duplicate" draft tab (workflowId/requestId
// null) -- an unsaved draft's in-progress edits were never persisted
// either, so restoring an empty draft tab pointing at nothing would be
// worse than just not restoring it. Same localStorage/cosmetic tier as
// theme/sidebar-collapse: pure UI navigation state, no domain meaning
// outside the running app.
export interface PersistedTabState {
  ids: string[]
  activeId: string | null // null means the pinned list tab was active
}

const EMPTY: PersistedTabState = { ids: [], activeId: null }

export function loadPersistedTabs(storageKey: string): PersistedTabState {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return EMPTY
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed === 'object' && parsed !== null &&
      Array.isArray((parsed as PersistedTabState).ids)
    ) {
      return parsed as PersistedTabState
    }
  } catch {
    // Malformed/corrupt localStorage content -- fall back to empty
    // rather than throwing during render.
  }
  return EMPTY
}

export function savePersistedTabs(storageKey: string, state: PersistedTabState): void {
  localStorage.setItem(storageKey, JSON.stringify(state))
}
