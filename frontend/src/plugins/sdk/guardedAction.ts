// A guarded action asks Mill to perform something the plugin cannot
// do itself -- open a URL, open a local app, erase a board item, or
// any other capability the manifest declares. Mill's own guardrail
// rules decide whether the request is allowed, parked for approval,
// or denied; the plugin only ever sees the outcome.

/** The outcome of one guarded-action request. approved is false for
 * both a denial and a still-pending approval that was later denied;
 * ruleLabel names the rule that decided, when there was one;
 * performed is true only once Mill actually carried the action out. */
export interface GuardedActionResult {
  approved: boolean
  effect: string
  ruleLabel: string
  performed: boolean
}
