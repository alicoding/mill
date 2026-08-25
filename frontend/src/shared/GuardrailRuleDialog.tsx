import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, FormControl, Radio, RadioGroup, Select, Text, TextInput, Textarea } from '@primer/react'
import { GuardrailEffect, GuardrailService } from './bindings'
import type { GuardrailRule } from './bindings'
import { useAppStore } from './store'
import { resolveScopeChoice, ruleScopeSentence, RULE_SCOPE_EVERYWHERE_SENTENCE } from './guardrailRuleScope'
import styles from './GuardrailRuleDialog.module.css'
import listStyles from './ListCard.module.css'

type NewScopeKind = 'workflow' | 'nodeType' | 'request'
type EffectValue = 'allow' | 'ask' | 'deny'

// The shared New/Edit rule form (door 2's "Rules for this step" Edit…
// action, door 3's Review "Rules" audit view) -- one form so a rule
// created or edited from either surface behaves identically. Scope is
// choosable only in NEW mode: an existing rule's scope renders as a
// static sentence (guardrail.Rule's scope fields are set once at
// create time; rescoping means delete and recreate, not an in-place
// edit).
export function GuardrailRuleDialog({ rule, onClose, onSaved }: {
  rule?: GuardrailRule
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation('views')
  const workflows = useAppStore((s) => s.workflows)
  const nodeTypes = useAppStore((s) => s.nodeTypes)
  const requests = useAppStore((s) => s.requests)

  const [label, setLabel] = useState(rule?.Label ?? '')
  const [effect, setEffect] = useState<EffectValue>((rule?.Effect as EffectValue) ?? 'allow')
  const [scopeKind, setScopeKind] = useState<NewScopeKind>('workflow')
  const [workflowId, setWorkflowId] = useState(workflows?.[0]?.ID ?? '')
  const [nodeTypeId, setNodeTypeId] = useState(nodeTypes?.[0]?.ID ?? '')
  const [requestId, setRequestId] = useState(requests?.[0]?.ID ?? '')
  const [condition, setCondition] = useState(rule?.Condition ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const editScope = rule ? resolveScopeChoice(rule, workflows, nodeTypes, requests) : null

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      if (rule) {
        await GuardrailService.UpdateRule({ ...rule, Label: label, Effect: effect as GuardrailEffect, Condition: condition })
      } else {
        const scopeFields = scopeKind === 'workflow' ? { WorkflowID: workflowId }
          : scopeKind === 'nodeType' ? { NodeTypeID: nodeTypeId }
          : { RequestID: requestId }
        await GuardrailService.CreateRule({
          ID: '', Label: label, Effect: effect as GuardrailEffect, Condition: condition, Source: '',
          NodeTypeID: '', RequestID: '', WorkflowID: '', NodeID: '',
          BuiltIn: false, Seed: { SeedRevision: 0, Modified: false },
          ...scopeFields,
        })
      }
      onSaved()
      onClose()
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      title={rule ? t('guardrailRuleDialog.editTitle') : t('guardrailRuleDialog.newTitle')}
      onClose={onClose}
      footerButtons={[
        { content: t('guardrailRuleDialog.cancel'), onClick: onClose },
        { content: t('guardrailRuleDialog.save'), buttonType: 'primary', onClick: () => void save(), disabled: saving || !label.trim() },
      ]}
    >
      <FormControl>
        <FormControl.Label>{t('guardrailRuleDialog.nameLabel')}</FormControl.Label>
        <TextInput value={label} onChange={(e) => setLabel(e.target.value)} data-testid="guardrail-rule-name" block />
      </FormControl>
      <FormControl>
        <FormControl.Label>{t('guardrailRuleDialog.effectLabel')}</FormControl.Label>
        <Select value={effect} onChange={(e) => setEffect(e.target.value as EffectValue)} data-testid="guardrail-rule-effect">
          <Select.Option value="allow">{t('guardrailRuleDialog.effectOptions.allow')}</Select.Option>
          <Select.Option value="ask">{t('guardrailRuleDialog.effectOptions.ask')}</Select.Option>
          <Select.Option value="deny">{t('guardrailRuleDialog.effectOptions.deny')}</Select.Option>
        </Select>
      </FormControl>
      {rule ? (
        <FormControl>
          <FormControl.Label>{t('guardrailRuleDialog.appliesToLabel')}</FormControl.Label>
          <Text as="p" size="small" className={listStyles.muted} data-testid="guardrail-rule-scope-static">
            {editScope ? ruleScopeSentence(editScope) : RULE_SCOPE_EVERYWHERE_SENTENCE}
          </Text>
        </FormControl>
      ) : (
        <RadioGroup name="guardrail-rule-scope-kind" onChange={(v) => v && setScopeKind(v as NewScopeKind)}>
          <RadioGroup.Label>{t('guardrailRuleDialog.appliesToLabel')}</RadioGroup.Label>
          {/* No "Everywhere" option: guardrail.Rule.Validate() requires at
              least one scope field, so a scope-less rule can never save --
              an option that always errors must not render (goal 0078
              review). The audit view's defensive "Applies everywhere."
              sentence/group stay, covering a rule saved before that
              validation existed. */}
          <FormControl>
            <Radio value="workflow" checked={scopeKind === 'workflow'} data-testid="guardrail-rule-scope-workflow" />
            <FormControl.Label>{t('guardrailRuleDialog.scopeOptions.workflow')}</FormControl.Label>
          </FormControl>
          {scopeKind === 'workflow' && (
            <Select
              value={workflowId}
              onChange={(e) => setWorkflowId(e.target.value)}
              className={styles.scopeSelect}
              data-testid="guardrail-rule-scope-workflow-select"
            >
              {(workflows ?? []).map((w) => <Select.Option key={w.ID} value={w.ID}>{w.Label}</Select.Option>)}
            </Select>
          )}
          <FormControl>
            <Radio value="nodeType" checked={scopeKind === 'nodeType'} data-testid="guardrail-rule-scope-nodetype" />
            <FormControl.Label>{t('guardrailRuleDialog.scopeOptions.nodeType')}</FormControl.Label>
          </FormControl>
          {scopeKind === 'nodeType' && (
            <Select
              value={nodeTypeId}
              onChange={(e) => setNodeTypeId(e.target.value)}
              className={styles.scopeSelect}
              data-testid="guardrail-rule-scope-nodetype-select"
            >
              {(nodeTypes ?? []).map((n) => <Select.Option key={n.ID} value={n.ID}>{n.Label}</Select.Option>)}
            </Select>
          )}
          <FormControl>
            <Radio value="request" checked={scopeKind === 'request'} data-testid="guardrail-rule-scope-request" />
            <FormControl.Label>{t('guardrailRuleDialog.scopeOptions.request')}</FormControl.Label>
          </FormControl>
          {scopeKind === 'request' && (
            <Select
              value={requestId}
              onChange={(e) => setRequestId(e.target.value)}
              className={styles.scopeSelect}
              data-testid="guardrail-rule-scope-request-select"
            >
              {(requests ?? []).map((r) => <Select.Option key={r.ID} value={r.ID}>{r.Label}</Select.Option>)}
            </Select>
          )}
        </RadioGroup>
      )}
      <details className={styles.conditionSection} data-testid="guardrail-rule-condition-section">
        <summary className={styles.conditionSummary}>{t('guardrailRuleDialog.conditionSummary')}</summary>
        <FormControl>
          <FormControl.Caption>{t('guardrailRuleDialog.conditionCaption')}</FormControl.Caption>
          <Textarea value={condition} onChange={(e) => setCondition(e.target.value)} rows={3} data-testid="guardrail-rule-condition" block />
        </FormControl>
      </details>
      {error && <Text as="p" size="small" className={listStyles.error} data-testid="guardrail-rule-error">{error}</Text>}
    </Dialog>
  )
}
