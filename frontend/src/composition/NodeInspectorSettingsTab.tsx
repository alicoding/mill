import { Stack } from '@primer/react'
import type { GuardrailRule, RuleTestResult } from '../shared/bindings'
import { NodeBreakpointSection } from './NodeBreakpointSection'
import { NodeGuardrailSection } from './NodeGuardrailSection'

// Tier 2 (goal 0327): how the step BEHAVES, one click from its
// parameters -- Approval, the rules that apply to it, and its
// breakpoint. Flat groups inside one tab rather than three
// disclosures, so the panel never asks for a second level of opening.
//
// Approval and Rules stay gated exactly as they were before the tabs
// existed: a workflow with no ID yet has nothing for a rule to attach
// to, and trigger/branch steps aren't gated by the execution guardrail
// at all. The Breakpoint group has no such gate -- every node card
// carries the dot, so every node's Settings tab shows its state.
export function NodeInspectorSettingsTab({ nodeId, showGuardrail, verdict, rules, onRulesChanged }: {
  nodeId: string
  showGuardrail: boolean
  verdict: RuleTestResult | null
  rules: GuardrailRule[]
  onRulesChanged: () => void
}) {
  return (
    <Stack direction="vertical" gap="normal" data-testid="inspector-tab-panel-settings">
      {showGuardrail && (
        <NodeGuardrailSection verdict={verdict} rules={rules} onRulesChanged={onRulesChanged} />
      )}
      <NodeBreakpointSection nodeId={nodeId} />
    </Stack>
  )
}
