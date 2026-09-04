/** The outcome of one guarded-action request. approved is false for
 * both a denial and a still-pending approval that was later denied;
 * ruleLabel names the rule that decided, when there was one;
 * performed is true only once Mill actually carried the action out. */
export interface GuardedActionResult {
    approved: boolean;
    effect: string;
    ruleLabel: string;
    performed: boolean;
}
