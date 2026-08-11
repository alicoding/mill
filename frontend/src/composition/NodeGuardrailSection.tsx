import { useEffect, useState } from 'react'
import { Label, Stack, Text } from '@primer/react'
import { BugIcon, ShieldIcon } from '@primer/octicons-react'
import { GuardrailService } from '../shared/bindings'
import type { RuleTestResult } from '../shared/bindings'
import { useNodeBreakpoint } from './breakpoints'
import styles from '../shared/ListCard.module.css'

// Read-only guardrail visibility for the selected step (docs/adr/0022's
// Update): shows the step's LIVE verdict -- the same evaluation the
// execution gate runs, so what you see here is what a run will do (§1's
// what-you-see-is-what-I-see thesis applied to the guardrail itself).
// Deliberately NOT an authoring surface: rules are policy, authored in
// Configure > Guardrails only -- putting rule creation on the step
// editor made policy look like step config, which it isn't (corrected
// directly in discussion).
//
// The breakpoint status line below is a NAMED EXCEPTION to that rule
// (docs/adr/0031 item 1): a breakpoint borrows the guardrail Rule/park
// plumbing without being policy -- exactly one instance-scoped
// Source:debug rule for this node, never a policy rule. Goal 0022
// moved the actual toggle OFF this Inspector panel and onto the node
// card itself (owner: "not sure why the debug is at the node level?" --
// the same "policy is not step config" lesson, applied to a debug
// control instead of an authoring one) -- this section now only
// SHOWS the current state, read from the same shared BreakpointContext
// (breakpoints.ts) the card's own dot reads, never its own fetch/CRUD.

const EFFECT_TEXT: Record<string, string> = {
  allow: 'runs without approval',
  ask: 'asks for your approval before running',
  deny: 'is denied and will not run',
}

export function NodeGuardrailSection({ workflowId, nodeId }: { workflowId: string; nodeId: string }) {
  const [verdict, setVerdict] = useState<RuleTestResult | null>(null)
  const breakpoint = useNodeBreakpoint(nodeId)

  useEffect(() => {
    GuardrailService.TestRules(workflowId, nodeId).then(setVerdict).catch(() => setVerdict(null))
  }, [workflowId, nodeId])

  return (
    <Stack direction="vertical" gap="condensed" data-testid="node-guardrail-section">
      {verdict && (
        <>
          <Stack direction="horizontal" gap="condensed" align="center">
            <ShieldIcon size={16} />
            <Label
              variant={verdict.effect === 'deny' ? 'danger' : verdict.effect === 'ask' ? 'attention' : 'success'}
              size="small"
              data-testid="node-guardrail-verdict"
            >
              {verdict.effect}
            </Label>
          </Stack>
          <Text size="small" className={styles.muted}>
            This step {EFFECT_TEXT[verdict.effect] ?? verdict.effect}
            {verdict.ruleLabel
              ? ` — rule "${verdict.ruleLabel}".`
              : verdict.effectClass === 'external' ? ' — external steps ask by default. Approvals happen in Review.' : '.'}
          </Text>
        </>
      )}
      <Stack direction="horizontal" gap="condensed" align="center">
        <BugIcon size={16} fill={breakpoint.isSet ? 'var(--bgColor-done-emphasis)' : 'var(--fgColor-muted)'} />
        <Text size="small" data-testid="breakpoint-status">
          {breakpoint.isSet ? 'Breakpoint set' : 'No breakpoint'} — click the dot on the node card to {breakpoint.isSet ? 'remove it' : 'add one'}.
        </Text>
        {breakpoint.isSet && (
          <Label variant="done" size="small" data-testid="breakpoint-badge">Breakpoint</Label>
        )}
      </Stack>
      <Text size="small" className={styles.muted}>
        A run pauses here to let you inspect and edit its data before it continues -- a debugging aid, not policy.
      </Text>
    </Stack>
  )
}
