// The two shapes a picked secret takes (goal 0306). A Configure
// entity's field holds a REFERENCE -- vaultref's own grammar,
// "vault:<id>" for the store's own entries and "<provider>:<source>/
// <KEY>" for a key read from a configured source. The title cache and
// a plugin's secretRef setting (ADR-0048) are keyed by the bare entry
// id instead. Converting between them lives here, once, so no field
// has to know which of the two shapes it is holding.

const VAULT_PREFIX = 'vault:'

// toReference qualifies a bare vault id. A provider-qualified id is
// already a reference and passes through untouched -- qualifying it
// again would turn a source-backed pick into a lookup for a vault
// entry that does not exist.
export function toReference(entryID: string): string {
  if (entryID === '' || entryID.includes(':')) return entryID
  return VAULT_PREFIX + entryID
}

// toEntryID is toReference's inverse.
export function toEntryID(reference: string): string {
  return reference.startsWith(VAULT_PREFIX) ? reference.slice(VAULT_PREFIX.length) : reference
}

// SourceRef is one provider-qualified id's two parts: which configured
// source answers it, and which key inside that source (goal 0408 S1).
export interface SourceRef {
  sourceID: string
  key: string
}

// parseSourceRef splits a provider-qualified id ("env:<source>/<KEY>")
// into its source and key, null for a bare vault id or a malformed
// one -- the same split vaultref.Split/strings.Cut make on the Go
// side, so a picker can name which source a reference points at
// without a round trip.
export function parseSourceRef(entryID: string): SourceRef | null {
  const colon = entryID.indexOf(':')
  if (colon < 0) return null
  const rest = entryID.slice(colon + 1)
  const slash = rest.indexOf('/')
  if (slash < 0) return null
  const sourceID = rest.slice(0, slash)
  const key = rest.slice(slash + 1)
  if (sourceID === '' || key === '') return null
  return { sourceID, key }
}
