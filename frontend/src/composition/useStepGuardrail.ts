import { useCallback, useEffect, useState } from 'react'
import { GuardrailService } from '../shared/bindings'
import type { GuardrailRule, RuleTestResult } from '../shared/bindings'

// The selected step's live guardrail picture: the verdict the execution
// gate would reach right now (TestRules is the same evaluation a run
// performs, so what the panel shows is what a run will do) plus the
// rules that actually apply to this step.
//
// Lifted out of NodeGuardrailSection (goal 0327) because the Settings
// tab's own label carries the applying-rule count -- the tab strip and
// the section it reveals must read one number, never two independent
// fetches that can disagree.
export interface StepGuardrail {
  verdict: RuleTestResult | null
  rules: GuardrailRule[]
  refreshRules: () => void
}

export function useStepGuardrail(workflowId: string, nodeId: string, enabled: boolean): StepGuardrail {
  const [verdict, setVerdict] = useState<RuleTestResult | null>(null)
  const [rules, setRules] = useState<GuardrailRule[]>([])

  const refreshRules = useCallback(() => {
    if (!enabled) {
      setRules([])
      return
    }
    GuardrailService.RulesForStep(workflowId, nodeId).then((r) => setRules(r ?? [])).catch(() => setRules([]))
  }, [workflowId, nodeId, enabled])

  useEffect(() => {
    if (!enabled) {
      setVerdict(null)
      return
    }
    GuardrailService.TestRules(workflowId, nodeId).then(setVerdict).catch(() => setVerdict(null))
  }, [workflowId, nodeId, enabled])

  useEffect(() => {
    refreshRules()
  }, [refreshRules])

  return { verdict, rules, refreshRules }
}
