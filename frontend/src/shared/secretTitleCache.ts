import { useSyncExternalStore } from 'react'
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
let loadError = ''
let loaded = false
const listeners = new Set<() => void>()

function notify(): void {
  listeners.forEach((l) => l())
}

export async function refreshSecretTitles(): Promise<void> {
  try {
    // The vault's entries, then every enabled secret source's keys
    // (ADR-0050) -- titles only, keyed by the reference each resolves as.
    const [vault, providers] = await Promise.all([SecretService.ListSecrets(), SecretService.ListProviderSecrets()])
    const next: Record<string, string> = {}
    const nextKinds: Record<string, Kind> = {}
    for (const e of [...(vault ?? []), ...(providers ?? [])]) {
      next[e.ID] = e.Title
      nextKinds[e.ID] = e.Kind || Kind.KindText
    }
    titles = next
    kinds = nextKinds
    loadError = ''
  } catch (err) {
    titles = {}
    kinds = {}
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
  error: string
  loaded: boolean
}

let snapshot: SecretTitles = { titles, kinds, error: loadError, loaded }
function rebuildSnapshot(): void {
  snapshot = { titles, kinds, error: loadError, loaded }
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
