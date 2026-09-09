import { useSyncExternalStore } from 'react'
import { Events } from '@wailsio/runtime'
import { SecretService } from './bindings'
import { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/secret/models'

// The vault's titles, id -> title, mirrored for synchronous reads
// (ADR-0048): a plugin's secretRef setting answers the TITLE of the
// picked entry (plugins/hostApi.ts), and the Extensions picker lists
// the same titles. Never a value -- ListSecrets is the masked summary.
// A failed load (locked vault, server mode without a vault) leaves
// the cache empty and remembers the error for the picker's caption.
let titles: Record<string, string> = {}
// kinds mirrors what each entry HOLDS (goal 0306), so a kind-filtered
// picker -- a client-certificate field listing certificates, a signing
// key field listing keys -- answers synchronously from the same cache
// the titles come from.
let kinds: Record<string, Kind> = {}
// trashed mirrors ListTrash's own id -> label (goal 0406 S2): a picker
// showing a vault-backed reference that currently names a Trashed entry
// says so distinctly, rather than falling into the generic "gone"
// caption a picker's own not-in-titles state otherwise reads as.
let trashed: Record<string, string> = {}
let loadError = ''
let loaded = false
const listeners = new Set<() => void>()

// A source's file changing on disk (goal 0408 S1) re-reads live at
// every resolve already; what this refetches is the LIST -- a key
// added or removed has to reach every open picker without a reload.
// Subscribed once here, at module scope, rather than per picker mount:
// this cache is a singleton every picker already shares.
Events.On('secrets:sources-changed', () => { void refreshSecretTitles() })

function notify(): void {
  listeners.forEach((l) => l())
}

export async function refreshSecretTitles(): Promise<void> {
  try {
    // The vault's entries, every enabled secret source's keys (ADR-0050),
    // and the vault's own Trash (goal 0406 S2) -- titles/labels only,
    // keyed by the reference each resolves as (ListTrash's ids are bare
    // vault ids, the same shape a vault entry's own id already is).
    const [vault, providers, trash] = await Promise.all([SecretService.ListSecrets(), SecretService.ListProviderSecrets(), SecretService.ListTrash()])
    const next: Record<string, string> = {}
    const nextKinds: Record<string, Kind> = {}
    for (const e of [...(vault ?? []), ...(providers ?? [])]) {
      next[e.ID] = e.Title
      nextKinds[e.ID] = e.Kind || Kind.KindText
    }
    const nextTrashed: Record<string, string> = {}
    for (const t of trash ?? []) {
      nextTrashed[t.id] = t.label
    }
    titles = next
    kinds = nextKinds
    trashed = nextTrashed
    loadError = ''
  } catch (err) {
    titles = {}
    kinds = {}
    trashed = {}
    loadError = String(err)
  }
  loaded = true
  notify()
}

export function secretTitleOf(id: string): string {
  return titles[id] ?? ''
}

export function secretTitlesSnapshot(): SecretTitles {
  return snapshot
}

export interface SecretTitles {
  titles: Record<string, string>
  kinds: Record<string, Kind>
  trashed: Record<string, string>
  error: string
  loaded: boolean
}

let snapshot: SecretTitles = { titles, kinds, trashed, error: loadError, loaded }
function rebuildSnapshot(): void {
  snapshot = { titles, kinds, trashed, error: loadError, loaded }
}
listeners.add(rebuildSnapshot)

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useSecretTitles(): SecretTitles {
  return useSyncExternalStore(subscribe, secretTitlesSnapshot)
}
