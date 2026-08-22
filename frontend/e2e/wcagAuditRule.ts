import { AxeBuilder } from '@axe-core/playwright'
import type { Page } from '@playwright/test'

// Goal 0157's second axe pass: axe-core's own bundled WCAG 2 A/AA rules
// (~90 rules shipped inside axe-core itself), scoped via withTags --
// no custom rule, no custom axeSource. Deliberately separate from
// layoutFitnessBuilder (layoutFitnessRule.ts), which stays scoped to
// ONLY the custom mill-layout-scroll rule via withRules -- the two
// passes audit different things and neither should silently start
// running the other's rules.
export const WCAG_TAGS = ['wcag2a', 'wcag2aa']

// Rule ids axe flags that this repo has triaged and rejected as false
// positives or deliberate product decisions -- never a blanket
// disable. Each entry names the rule id and the reason; see
// docs/goals/0157-a11y-audit-enablement.md for the full inventory this
// was triaged from. Empty at the goal 0157 baseline -- every real
// violation the first measurement pass found (nested-interactive,
// link-in-text-block) was cheap enough to fix outright; this map is
// the mechanism for the next one that isn't.
export const EXEMPT_RULE_IDS: Record<string, string> = {}

export function wcagAuditBuilder(page: Page): AxeBuilder {
  return new AxeBuilder({ page }).withTags(WCAG_TAGS)
}
