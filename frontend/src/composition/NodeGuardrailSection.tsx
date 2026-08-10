import { useEffect, useState } from 'react'
import { Label, Stack, Text } from '@primer/react'
import { ShieldIcon } from '@primer/octicons-react'
import { GuardrailService } from '../shared/bindings'
import type { RuleTestResult } from '../shared/bindings'
import styles from '../shared/ListCard.module.css'

// Read-only guardrail visibility for the selected step (docs/adr/0022's
// Update): shows the step's LIVE verdict -- the same evaluation the
// execution gate runs, so what you see here is what a run will do (§1's
// what-you-see-is-what-I-see thesis applied to the guardrail itself).
// Deliberately NOT an authoring surface: rules are policy, authored in
// Configure > Guardrails only -- putting rule creation on the step
// editor made policy look like step config, which it isn't (corrected
// directly in discussion).

const EFFECT_TEXT: Record<string, string> = {
  allow: 'runs without approval',
  ask: 'asks for your approval before running',
  deny: 'is denied and will not run',
}

export function NodeGuardrailSection({ workflowId, nodeId }: { workflowId: string; nodeId: string }) {
  const [verdict, setVerdict] = useState<RuleTestResult | null>(null)

  useEffect(() => {
    GuardrailService.TestRules(workflowId, nodeId).then(setVerdict).catch(() => setVerdict(null))
  }, [workflowId, nodeId])

  if (!verdict) return null
  const variant = verdict.effect === 'deny' ? 'danger' : verdict.effect === 'ask' ? 'attention' : 'success'
  return (
    <Stack direction="vertical" gap="condensed" data-testid="node-guardrail-section">
      <Stack direction="horizontal" gap="condensed" align="center">
        <ShieldIcon size={16} />
        <Label variant={variant} size="small" data-testid="node-guardrail-verdict">{verdict.effect}</Label>
      </Stack>
      <Text size="small" className={styles.muted}>
        This step {EFFECT_TEXT[verdict.effect] ?? verdict.effect}
        {verdict.ruleLabel
          ? ` — rule "${verdict.ruleLabel}".`
          : verdict.effectClass === 'external' ? ' — external steps ask by default. Approvals happen in Review.' : '.'}
      </Text>
    </Stack>
  )
}
