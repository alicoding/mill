import type { PendingApproval } from './bindings'

// A parked run's reason, when the park is not a decision anyone is
// asked for (goal 0360 S2): the step needs a secret and the vault is
// locked, so the run waits for an unlock. Every surface that renders a
// park branches on this one predicate, so the card, the badge, the
// dock and the notices can never disagree about what the run waits on.
export const VAULT_LOCKED_REASON = 'vault-locked'

export function isVaultWait(pending: Pick<PendingApproval, 'reason'> | null | undefined): boolean {
  return pending?.reason === VAULT_LOCKED_REASON
}
