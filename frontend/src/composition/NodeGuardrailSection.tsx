import { useEffect, useState } from 'react'
import { Button, Label, Stack, Text } from '@primer/react'
import { BugIcon, ShieldIcon } from '@primer/octicons-react'
import { GuardrailService } from '../shared/bindings'
import type { RuleTestResult } from '../shared/bindings'
import { Effect as GuardrailEffect } from '../../bindings/github.com/alicoding/mill/internal/domain/guardrail/models'
import type { Rule } from '../../bindings/github.com/alicoding/mill/internal/domain/guardrail/models'
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
// The "Breakpoint" toggle below is the one NAMED EXCEPTION to that rule
// (docs/adr/0031 item 1): a breakpoint borrows the guardrail Rule/park
// plumbing without being policy -- it CRUDs exactly one instance-scoped
// Source:debug rule for this node, never a policy rule.

const EFFECT_TEXT: Record<string, string> = {
  allow: 'runs without approval',
  ask: 'asks for your approval before running',
  deny: 'is denied and will not run',
}

const DEBUG_SOURCE = 'debug'

export function NodeGuardrailSection({ workflowId, nodeId, onBreakpointChange }: { workflowId: string; nodeId: string; onBreakpointChange: () => void }) {
  const [verdict, setVerdict] = useState<RuleTestResult | null>(null)
  const [breakpoint, setBreakpoint] = useState<Rule | null>(null)
  const [breakpointBusy, setBreakpointBusy] = useState(false)

  const refresh = () => {
    GuardrailService.TestRules(workflowId, nodeId).then(setVerdict).catch(() => setVerdict(null))
    GuardrailService.Rules()
      .then((rules) => {
        const bp = (rules ?? []).find((r) => r.Source === DEBUG_SOURCE && r.WorkflowID === workflowId && r.NodeID === nodeId)
        setBreakpoint(bp ?? null)
      })
      .catch(() => setBreakpoint(null))
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowId, nodeId])

  const toggleBreakpoint = () => {
    setBreakpointBusy(true)
    const done = () => {
      setBreakpointBusy(false)
      refresh()
      onBreakpointChange()
    }
    if (breakpoint) {
      GuardrailService.DeleteRule(breakpoint.ID).then(done).catch(done)
    } else {
      GuardrailService.CreateRule({
        ID: '', Label: 'Breakpoint', Effect: GuardrailEffect.EffectAsk, Source: DEBUG_SOURCE,
        WorkflowID: workflowId, NodeID: nodeId, NodeTypeID: '', RequestID: '', Condition: '',
      }).then(done).catch(done)
    }
  }

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
        <BugIcon size={16} fill={breakpoint ? 'var(--bgColor-done-emphasis)' : 'var(--fgColor-muted)'} />
        <Button
          size="small"
          disabled={breakpointBusy}
          data-testid="toggle-breakpoint"
          onClick={toggleBreakpoint}
        >
          {breakpoint ? 'Remove breakpoint' : 'Add breakpoint'}
        </Button>
        {breakpoint && (
          <Label variant="done" size="small" data-testid="breakpoint-badge">Breakpoint</Label>
        )}
      </Stack>
      <Text size="small" className={styles.muted}>
        A run pauses here to let you inspect and edit its data before it continues -- a debugging aid, not policy.
      </Text>
    </Stack>
  )
}
