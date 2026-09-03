import { useSyncExternalStore } from 'react'
import { SecretService } from './bindings'

// The vault's titles, id -> title, mirrored for synchronous reads
// (ADR-0048): a plugin's secretRef setting answers the TITLE of the
// picked entry (plugins/hostApi.ts), and the Extensions picker lists
// the same titles. Never a value -- ListSecrets is the masked summary.
// A failed load (locked vault, server mode without a vault) leaves
// the cache empty and remembers the error for the picker's caption.
let titles: Record<string, string> = {}
let loadError = ''
let loaded = false
const listeners = new Set<() => void>()

function notify(): void {
  listeners.forEach((l) => l())
}

export async function refreshSecretTitles(): Promise<void> {
  try {
    const list = (await SecretService.ListSecrets()) ?? []
    const next: Record<string, string> = {}
    for (const e of list) next[e.ID] = e.Title
    titles = next
    loadError = ''
  } catch (err) {
    titles = {}
    loadError = String(err)
  }
  loaded = true
  notify()
}

export function secretTitleOf(id: string): string {
  return titles[id] ?? ''
}

export function secretTitlesSnapshot(): { titles: Record<string, string>; error: string; loaded: boolean } {
  return snapshot
}

let snapshot = { titles, error: loadError, loaded }
function rebuildSnapshot(): void {
  snapshot = { titles, error: loadError, loaded }
}
listeners.add(rebuildSnapshot)

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useSecretTitles(): { titles: Record<string, string>; error: string; loaded: boolean } {
  return useSyncExternalStore(subscribe, secretTitlesSnapshot)
}
