import type { RunStep } from '../shared/bindings'

// The step inspector's three tiers (goal 0327): tier 1 is what the step
// IS and does (its own parameters), tier 2 is how it BEHAVES (approval,
// rules, breakpoint), tier 3 is metadata (the I/O contract + docs, a
// footer under every tab). At most two disclosure levels, so the tier-2
// groups are flat inside their tab rather than each collapsible.
export type InspectorTab = 'parameters' | 'settings' | 'test'

// StepTestSection refuses trigger and decision steps outright -- a
// trigger has no input to try, a branch routes rather than transforms
// -- so those kinds get no Test tab and the panel never offers an
// empty room. They still RECORD data on a run, though, so the tab
// comes back for them whenever the displayed run has step data to
// show: the tab set follows what the tab would actually contain.
const KINDS_WITHOUT_TEST = new Set(['trigger', 'decision'])

export function inspectorTabsFor(kind: string, hasRunData = false): InspectorTab[] {
  return KINDS_WITHOUT_TEST.has(kind) && !hasRunData
    ? ['parameters', 'settings']
    : ['parameters', 'settings', 'test']
}

// A remembered tab that this node doesn't currently offer falls back to
// the first tier rather than rendering nothing.
export function clampTab(tab: string | null, kind: string, hasRunData = false): InspectorTab {
  const tabs = inspectorTabsFor(kind, hasRunData)
  return tabs.includes(tab as InspectorTab) ? (tab as InspectorTab) : 'parameters'
}

// Whether the selected run recorded anything for this step -- the same
// emptiness test NodeExecutionSection applies before it renders, so the
// Test tab's counter can never promise data the tab doesn't show.
export function hasRunStepData(step: RunStep | undefined): boolean {
  if (!step) return false
  const inputAttrs = step.inputAttributes && Object.keys(step.inputAttributes).length > 0
  const outputAttrs = step.outputAttributes && Object.keys(step.outputAttributes).length > 0
  return !!(step.input || inputAttrs || step.output || outputAttrs)
}

export interface InspectorTabBadges {
  // Rules that apply to this step -- undefined leaves the tab label bare.
  settingsCount?: number
  // A breakpoint is a state, not a quantity: it renders as a glyph on
  // the Settings label rather than a number.
  settingsBreakpoint: boolean
  testCount?: number
}

export function inspectorTabBadges(input: {
  ruleCount: number
  breakpointSet: boolean
  runStep: RunStep | undefined
}): InspectorTabBadges {
  return {
    settingsCount: input.ruleCount > 0 ? input.ruleCount : undefined,
    settingsBreakpoint: input.breakpointSet,
    testCount: hasRunStepData(input.runStep) ? 1 : undefined,
  }
}
