import { useEffect, useState } from 'react'
import { Button, FormControl, Heading, IconButton, Label, Select, Stack, Text, TextInput } from '@primer/react'
import { TrashIcon, ShieldIcon } from '@primer/octicons-react'
import { GuardrailService } from '../../bindings/github.com/alicoding/mill'
import { Effect, type Rule } from '../../bindings/github.com/alicoding/mill/internal/domain/guardrail/models'
import type { RuleTestResult } from '../../bindings/github.com/alicoding/mill/models'
import { refreshRequests, refreshWorkflows, refreshNodeTypes, useAppStore } from '../shared/store'
import styles from '../shared/ListCard.module.css'
import PageContainer from '../shared/PageContainer'

// Configure's Guardrails section (docs/SPEC.md §8, ADR-0019/0022):
// author allow/ask/deny rules at the node-type, integration, or
// workflow-step scope, and dry-run them against a real step before
// trusting them live -- §8's locked testability requirement ("a policy
// rule that's silently broader than intended is exactly how a guardrail
// fails quietly"). Deny always beats ask beats allow, no matter which
// scope set it.

const EFFECT_LABEL: Record<string, string> = {
  allow: 'Allow (skip approval)',
  ask: 'Require approval',
  deny: 'Deny (never run)',
}

export function ConfigureGuardrails() {
  const workflows = useAppStore((s) => s.workflows)
  const requests = useAppStore((s) => s.requests)
  const nodeTypes = useAppStore((s) => s.nodeTypes)
  const [rules, setRules] = useState<Rule[] | null>(null)
  const [error, setError] = useState('')

  // Create-form state.
  const [label, setLabel] = useState('')
  const [effect, setEffect] = useState<string>(Effect.EffectAllow)
  const [nodeTypeID, setNodeTypeID] = useState('')
  const [requestID, setRequestID] = useState('')
  const [workflowID, setWorkflowID] = useState('')
  const [nodeID, setNodeID] = useState('')
  const [condition, setCondition] = useState('')

  // Dry-run tester state.
  const [testWorkflowID, setTestWorkflowID] = useState('')
  const [testNodeID, setTestNodeID] = useState('')
  const [testResult, setTestResult] = useState<RuleTestResult | null>(null)

  const refreshRules = () => {
    GuardrailService.Rules().then((r) => setRules(r ?? [])).catch((err) => setError(String(err)))
  }
  useEffect(() => {
    refreshRules()
    void refreshWorkflows(); void refreshRequests(); void refreshNodeTypes()
  }, [])

  const createRule = () => {
    setError('')
    GuardrailService.CreateRule({
      ID: '', Label: label, Effect: effect as Effect,
      NodeTypeID: nodeTypeID, RequestID: requestID, WorkflowID: workflowID, NodeID: nodeID,
      Condition: condition,
    })
      .then(() => {
        setLabel(''); setNodeTypeID(''); setRequestID(''); setWorkflowID(''); setNodeID(''); setCondition('')
        refreshRules()
      })
      .catch((err) => setError(String(err)))
  }

  const runTest = () => {
    setError('')
    setTestResult(null)
    GuardrailService.TestRules(testWorkflowID, testNodeID)
      .then(setTestResult)
      .catch((err) => setError(String(err)))
  }

  const scopeSummary = (r: Rule) => {
    const parts: string[] = []
    if (r.NodeTypeID) parts.push(`node type: ${r.NodeTypeID}`)
    if (r.RequestID) parts.push(`integration: ${requests?.find((q) => q.ID === r.RequestID)?.Label ?? r.RequestID}`)
    if (r.WorkflowID) parts.push(`workflow: ${workflows?.find((w) => w.ID === r.WorkflowID)?.Label ?? r.WorkflowID}`)
    if (r.NodeID) parts.push(`step: ${r.NodeID}`)
    return parts.join(' · ')
  }

  const stepOptions = (wfID: string) =>
    (workflows?.find((w) => w.ID === wfID)?.Nodes ?? []).filter((n) => n.Kind !== 'trigger' && n.Kind !== 'decision')

  const effectVariant = (e: string) => (e === 'deny' ? 'danger' : e === 'ask' ? 'attention' : 'success')

  return (
    <PageContainer variant="narrow" data-testid="configure-guardrails">
      <Stack direction="horizontal" gap="condensed" align="center" className={styles.sectionHeading}>
        <ShieldIcon size={16} />
        <Heading as="h2" variant="small">Guardrail rules</Heading>
      </Stack>
      <Text as="p" size="small" className={styles.muted}>
        External steps (HTTP calls, MCP tool calls) require approval by default — friction is the
        default, speed is the opt-in. An allow rule skips the ask for steps you trust; a deny rule
        blocks them outright. Deny always wins over ask, and ask over allow, no matter which scope
        set it.
      </Text>
      {error && <Text as="p" size="small" className={styles.error} data-testid="guardrail-error">{error}</Text>}

      {rules !== null && rules.length === 0 && (
        <Text as="p" className={styles.muted}>No rules yet — every external step asks for approval.</Text>
      )}
      {rules !== null && rules.length > 0 && (
        <Stack direction="vertical" gap="condensed">
          {rules.map((r) => (
            <div key={r.ID} className={styles.card} data-testid="guardrail-rule-row">
              <Stack direction="horizontal" justify="space-between" align="center" gap="normal">
                <div>
                  <Stack direction="horizontal" gap="condensed" align="center">
                    <Label variant={effectVariant(r.Effect)} size="small">{EFFECT_LABEL[r.Effect] ?? r.Effect}</Label>
                    <Text weight="semibold">{r.Label || '(unnamed rule)'}</Text>
                  </Stack>
                  <Text as="p" size="small" className={styles.muted}>{scopeSummary(r)}</Text>
                  {r.Condition && <Text as="p" size="small" className={styles.muted}>when: <code>{r.Condition}</code></Text>}
                </div>
                <IconButton icon={TrashIcon} aria-label={`Delete rule ${r.Label || r.ID}`} size="small" variant="invisible"
                  onClick={() => { GuardrailService.DeleteRule(r.ID).then(refreshRules).catch((err) => setError(String(err))) }} />
              </Stack>
            </div>
          ))}
        </Stack>
      )}

      <Heading as="h3" variant="small" className={styles.sectionHeading}>New rule</Heading>
      <Stack direction="vertical" gap="condensed">
        <FormControl>
          <FormControl.Label>Name</FormControl.Label>
          <TextInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. httpbin echo is trusted" block />
        </FormControl>
        <FormControl>
          <FormControl.Label>Effect</FormControl.Label>
          <Select value={effect} onChange={(e) => setEffect(e.target.value)}>
            <Select.Option value="allow">{EFFECT_LABEL.allow}</Select.Option>
            <Select.Option value="ask">{EFFECT_LABEL.ask}</Select.Option>
            <Select.Option value="deny">{EFFECT_LABEL.deny}</Select.Option>
          </Select>
        </FormControl>
        <FormControl>
          <FormControl.Label>Node type</FormControl.Label>
          <Select value={nodeTypeID} onChange={(e) => setNodeTypeID(e.target.value)}>
            <Select.Option value="">Any node type</Select.Option>
            {(nodeTypes ?? []).filter((nt) => nt.Kind !== 'trigger' && nt.Kind !== 'decision').map((nt) => (
              <Select.Option key={nt.ID} value={nt.ID}>{nt.Label}</Select.Option>
            ))}
          </Select>
          <FormControl.Caption>Scope fields combine — every one you set must match.</FormControl.Caption>
        </FormControl>
        <FormControl>
          <FormControl.Label>Integration</FormControl.Label>
          <Select value={requestID} onChange={(e) => setRequestID(e.target.value)}>
            <Select.Option value="">Any integration</Select.Option>
            {(requests ?? []).map((r) => <Select.Option key={r.ID} value={r.ID}>{r.Label}</Select.Option>)}
          </Select>
        </FormControl>
        <FormControl>
          <FormControl.Label>Workflow</FormControl.Label>
          <Select value={workflowID} onChange={(e) => { setWorkflowID(e.target.value); setNodeID('') }}>
            <Select.Option value="">Any workflow</Select.Option>
            {(workflows ?? []).map((w) => <Select.Option key={w.ID} value={w.ID}>{w.Label}</Select.Option>)}
          </Select>
        </FormControl>
        {workflowID && (
          <FormControl>
            <FormControl.Label>Step</FormControl.Label>
            <Select value={nodeID} onChange={(e) => setNodeID(e.target.value)}>
              <Select.Option value="">Any step in this workflow</Select.Option>
              {stepOptions(workflowID).map((n) => <Select.Option key={n.ID} value={n.ID}>{n.NodeTypeID} ({n.ID})</Select.Option>)}
            </Select>
          </FormControl>
        )}
        <FormControl>
          <FormControl.Label>Condition (optional)</FormControl.Label>
          <TextInput value={condition} onChange={(e) => setCondition(e.target.value)}
            placeholder={'e.g. Config["method"] == "GET"'} block />
          <FormControl.Caption>
            Same expression language as Decision edges, over Payload / Attributes / Config. A broken
            condition fails safe: it can never widen an allow or disarm a deny.
          </FormControl.Caption>
        </FormControl>
        <div>
          <Button variant="primary" onClick={createRule} data-testid="create-guardrail-rule">Create rule</Button>
        </div>
      </Stack>

      <Heading as="h3" variant="small" className={styles.sectionHeading}>Test rules</Heading>
      <Text as="p" size="small" className={styles.muted}>
        See what would happen to a real step before trusting a rule live.
      </Text>
      <Stack direction="vertical" gap="condensed">
        <FormControl>
          <FormControl.Label>Workflow</FormControl.Label>
          <Select value={testWorkflowID} onChange={(e) => { setTestWorkflowID(e.target.value); setTestNodeID(''); setTestResult(null) }}>
            <Select.Option value="">Pick a workflow…</Select.Option>
            {(workflows ?? []).map((w) => <Select.Option key={w.ID} value={w.ID}>{w.Label}</Select.Option>)}
          </Select>
        </FormControl>
        {testWorkflowID && (
          <FormControl>
            <FormControl.Label>Step</FormControl.Label>
            <Select value={testNodeID} onChange={(e) => { setTestNodeID(e.target.value); setTestResult(null) }}>
              <Select.Option value="">Pick a step…</Select.Option>
              {stepOptions(testWorkflowID).map((n) => <Select.Option key={n.ID} value={n.ID}>{n.NodeTypeID} ({n.ID})</Select.Option>)}
            </Select>
          </FormControl>
        )}
        <div>
          <Button onClick={runTest} disabled={!testWorkflowID || !testNodeID} data-testid="test-guardrail-rules">
            Test
          </Button>
        </div>
        {testResult && (
          <div className={styles.card} data-testid="guardrail-test-result">
            <Stack direction="horizontal" gap="condensed" align="center">
              <Label variant={effectVariant(testResult.effect)} size="small">{EFFECT_LABEL[testResult.effect] ?? testResult.effect}</Label>
              <Text size="small">
                {testResult.ruleLabel
                  ? `decided by rule "${testResult.ruleLabel}"`
                  : `the default for a ${testResult.effectClass}-effect step (no rule matched)`}
              </Text>
            </Stack>
          </div>
        )}
      </Stack>
    </PageContainer>
  )
}
