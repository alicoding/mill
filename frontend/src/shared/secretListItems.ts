import type { SecretSummary } from './bindings'
import type { Source as SecretSource } from '../../bindings/github.com/alicoding/mill/internal/domain/secretsource/models'
import { parseSourceRef } from './secretReference'

// The Secrets list's merge (goal 0408 S2): a source key is a secret
// ENTRY, in the same list as the vault's own entries -- pure so the
// merge/group shape is unit-testable without mounting SecretsView.

// One provider-backed key, parsed from ListProviderSecrets' own
// qualified-reference id and joined against the enabled sources for a
// human label/kind. A row whose id doesn't parse, or whose source has
// since been removed (a race between the two RPCs mid-refresh), is
// dropped rather than shown half-labelled -- both can only last a
// moment, never a state a reader actually sees.
export interface ProviderSecretRow {
  id: string
  key: string
  sourceID: string
  sourceLabel: string
  sourceKind: string
  updatedAt: string
}

export function providerSecretRows(provider: SecretSummary[], sources: SecretSource[]): ProviderSecretRow[] {
  const bySourceID = new Map(sources.map((s) => [s.ID, s]))
  const out: ProviderSecretRow[] = []
  for (const p of provider) {
    const parsed = parseSourceRef(p.ID)
    if (!parsed) continue
    const source = bySourceID.get(parsed.sourceID)
    if (!source) continue
    out.push({ id: p.ID, key: parsed.key, sourceID: source.ID, sourceLabel: source.Label, sourceKind: source.Kind, updatedAt: p.UpdatedAt })
  }
  return out
}

// A vault entry whose SourceRef no longer resolves (goal 0408 S2's
// "unresolved row"): the key it named vanished from the source's own
// file/tool while the ENTRY itself -- its id, its history -- is
// untouched. Distinct from a SourceRef naming a source that was itself
// removed, which stays the plain "this entry's source is gone" state
// SecretDetailSource already renders and this function leaves alone
// (returns null). Computed client-side from data the Secrets view
// already has -- the same reasoning SecretPicker.tsx's own unresolved
// caption gives, never a per-row RPC.
export interface VaultUnresolvedInfo {
  key: string
  sourceLabel: string
}

export function vaultUnresolvedInfo(
  sourceRef: string,
  providerIDs: ReadonlySet<string>,
  sources: SecretSource[],
): VaultUnresolvedInfo | null {
  if (!sourceRef || providerIDs.has(sourceRef)) return null
  const parsed = parseSourceRef(sourceRef)
  if (!parsed) return null
  const source = sources.find((s) => s.ID === parsed.sourceID)
  if (!source) return null
  return { key: parsed.key, sourceLabel: source.Label }
}
