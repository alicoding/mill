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
