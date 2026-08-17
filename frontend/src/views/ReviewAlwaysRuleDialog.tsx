import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, FormControl, Radio, RadioGroup, Text, TextInput } from '@primer/react'
import { ExecutionService, GuardrailEffect, GuardrailService } from '../shared/bindings'
import type { RunSummary } from '../shared/bindings'
import { useAppStore } from '../shared/store'
import { ruleNameForScope, ruleScopeSentence } from '../shared/guardrailRuleScope'
import type { RuleFromParkEffect, RuleScopeChoice } from '../shared/guardrailRuleScope'
import styles from '../shared/ListCard.module.css'

type ScopeKind = 'step' | 'workflow' | 'nodeType' | 'request'

// Door 1's rule-from-park dialog (goal 0078): scope-only (no Condition
// field -- create-from-park never needs the advanced editor), always
// saves the new rule THEN resolves the parked run with the same
// effect, so the workflow unsticks in the same action that authors the
// rule. Least-privilege default: the narrowest scope (this exact step)
// starts selected, never a broader one.
export function ReviewAlwaysRuleDialog({ run, effect, onClose, onResolved }: {
  run: RunSummary
  effect: RuleFromParkEffect
  onClose: () => void
  onResolved: () => void
}) {
  const { t } = useTranslation('views')
  const requests = useAppStore((s) => s.requests)
  const pending = run.pending
  const requestId = pending?.config?.requestId ?? ''
  const requestLabel = requests?.find((r) => r.ID === requestId)?.Label ?? requestId

  const scopeFor = (kind: ScopeKind): RuleScopeChoice => {
    switch (kind) {
      case 'step':
        return { kind: 'step', workflowLabel: run.workflowLabel, nodeTypeLabel: pending?.nodeTypeLabel || pending?.nodeTypeID || '' }
      case 'workflow':
        return { kind: 'workflow', workflowLabel: run.workflowLabel }
      case 'nodeType':
        return { kind: 'nodeType', nodeTypeLabel: pending?.nodeTypeLabel || pending?.nodeTypeID || '' }
      case 'request':
        return { kind: 'request', requestLabel }
    }
  }

  const [scopeKind, setScopeKind] = useState<ScopeKind>('step')
  const [ruleName, setRuleName] = useState(() => ruleNameForScope(effect, scopeFor('step')))
  const [nameTouched, setNameTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Regenerates the name as the scope radio changes -- UNTIL the user
  // edits the field by hand (nameTouched), matching the design's
  // "prefilled, regenerating until touched" contract.
  useEffect(() => {
    if (nameTouched) return
    setRuleName(ruleNameForScope(effect, scopeFor(scopeKind)))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scopeFor is derived from run/pending props, not independent reactive state
  }, [scopeKind, effect, nameTouched])

  if (!pending) return null

  const save = async () => {
    setSaving(true)
    setError('')
    const scopeFields = scopeKind === 'step' ? { WorkflowID: run.workflowID, NodeID: pending.nodeID }
      : scopeKind === 'workflow' ? { WorkflowID: run.workflowID }
      : scopeKind === 'nodeType' ? { NodeTypeID: pending.nodeTypeID }
      : { RequestID: requestId }
    try {
      await GuardrailService.CreateRule({
        ID: '', Label: ruleName, Effect: (effect === 'allow' ? GuardrailEffect.EffectAllow : GuardrailEffect.EffectDeny), Condition: '', Source: '',
        NodeTypeID: '', RequestID: '', WorkflowID: '', NodeID: '',
        ...scopeFields,
      })
    } catch (err) {
      setError(String(err))
      setSaving(false)
      return
    }
    try {
      await ExecutionService.ResolveApproval(run.runID, pending.nodeID, effect === 'allow', {}, false)
      onResolved()
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      title={effect === 'allow' ? t('reviewView.alwaysAllowTitle') : t('reviewView.alwaysDenyTitle')}
      onClose={onClose}
      footerButtons={[
        { content: t('reviewView.alwaysCancel'), onClick: onClose },
        {
          content: effect === 'allow' ? t('reviewView.alwaysSaveAndApprove') : t('reviewView.alwaysSaveAndDeny'),
          buttonType: effect === 'allow' ? 'primary' : 'danger',
          onClick: () => void save(),
          disabled: saving || !ruleName.trim(),
        },
      ]}
    >
      <Text as="p" size="small" className={styles.muted} data-testid="review-always-context">
        {t('reviewView.alwaysContextLine', { nodeType: pending.nodeTypeLabel || pending.nodeTypeID, workflow: run.workflowLabel })}
      </Text>
      <RadioGroup name="review-always-scope" onChange={(v) => v && setScopeKind(v as ScopeKind)}>
        <RadioGroup.Label>{t('reviewView.alwaysAppliesToLabel')}</RadioGroup.Label>
        <FormControl>
          <Radio value="step" checked={scopeKind === 'step'} data-testid="review-always-scope-step" />
          <FormControl.Label>{ruleScopeSentence(scopeFor('step'))}</FormControl.Label>
        </FormControl>
        <FormControl>
          <Radio value="workflow" checked={scopeKind === 'workflow'} data-testid="review-always-scope-workflow" />
          <FormControl.Label>{ruleScopeSentence(scopeFor('workflow'))}</FormControl.Label>
        </FormControl>
        <FormControl>
          <Radio value="nodeType" checked={scopeKind === 'nodeType'} data-testid="review-always-scope-nodetype" />
          <FormControl.Label>{ruleScopeSentence(scopeFor('nodeType'))}</FormControl.Label>
        </FormControl>
        {requestId !== '' && (
          <FormControl>
            <Radio value="request" checked={scopeKind === 'request'} data-testid="review-always-scope-request" />
            <FormControl.Label>{ruleScopeSentence(scopeFor('request'))}</FormControl.Label>
          </FormControl>
        )}
      </RadioGroup>
      <FormControl>
        <FormControl.Label>{t('reviewView.alwaysRuleNameLabel')}</FormControl.Label>
        <TextInput
          value={ruleName}
          onChange={(e) => { setRuleName(e.target.value); setNameTouched(true) }}
          data-testid="review-always-rule-name"
          block
        />
      </FormControl>
      {error && <Text as="p" size="small" className={styles.error} data-testid="review-always-error">{error}</Text>}
    </Dialog>
  )
}
