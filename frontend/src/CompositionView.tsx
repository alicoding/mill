import { useEffect, useState } from 'react'
import { Button, FormControl, Heading, IconButton, Label, Select, Stack, Text, TextInput, Textarea, Token } from '@primer/react'
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon } from '@primer/octicons-react'
import { CompositionService } from '../bindings/github.com/alicoding/mill'
import type { NodeType, Step, Workflow } from '../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import styles from './RunbookView.module.css'

const KIND_VARIANT: Record<string, 'accent' | 'success' | 'severe'> = {
  capture: 'accent',
  process: 'success',
  apply: 'severe',
}

// A draft step in the "new workflow" form: always carries a full config
// map (pre-filled from the node type's declared defaults the moment
// it's added), never a bare node-type reference -- composing is
// inseparable from configuring, per docs/SPEC.md §3.
interface DraftStep {
  nodeTypeID: string
  config: Record<string, string>
}

function defaultConfigFor(nodeType: NodeType): Record<string, string> {
  const config: Record<string, string> = {}
  for (const field of nodeType.ConfigFields ?? []) {
    config[field.Key] = field.Default
  }
  return config
}

// A prototype for SPEC.md §3 / ADR-0005 (config-first, canvas deferred):
// node types and workflows render as plain lists/chip-chains, not a
// canvas/graph library -- deliberately, to test that call visually
// instead of only asserting it in prose. Workflows here run the same
// real clipboard/markdown capability internal/domain/runbook already
// ships, decomposed into reusable steps -- internal/domain/runbook
// itself is untouched. Composing a workflow always configures it: a
// step is added with its config fields already visible and editable,
// never as a bare, unconfigured node-type reference.
function CompositionView() {
  const [nodeTypes, setNodeTypes] = useState<NodeType[] | null>(null)
  const [workflows, setWorkflows] = useState<Workflow[] | null>(null)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  const [draftLabel, setDraftLabel] = useState('')
  const [draftDescription, setDraftDescription] = useState('')
  const [draftSteps, setDraftSteps] = useState<DraftStep[]>([])
  const [addNodeTypeID, setAddNodeTypeID] = useState('')
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)

  const refetchWorkflows = () => {
    CompositionService.Workflows().then((list) => setWorkflows(list ?? [])).catch(console.error)
  }

  useEffect(() => {
    CompositionService.NodeTypes().then((list) => setNodeTypes(list ?? [])).catch(console.error)
    refetchWorkflows()
  }, [])

  const nodeById = (id: string) => nodeTypes?.find((n) => n.ID === id)

  const run = (id: string) => {
    setRunningId(id)
    setErrors((prev) => ({ ...prev, [id]: '' }))
    CompositionService.RunWorkflow(id)
      .then((output) => setResults((prev) => ({ ...prev, [id]: output })))
      .catch((err) => setErrors((prev) => ({ ...prev, [id]: String(err) })))
      .finally(() => setRunningId(null))
  }

  const removeWorkflow = (id: string) => {
    CompositionService.DeleteWorkflow(id).then(refetchWorkflows).catch(console.error)
  }

  const addStep = () => {
    const nt = nodeById(addNodeTypeID)
    if (!nt) return
    setDraftSteps((prev) => [...prev, { nodeTypeID: nt.ID, config: defaultConfigFor(nt) }])
    setAddNodeTypeID('')
  }

  const removeStep = (index: number) => {
    setDraftSteps((prev) => prev.filter((_, i) => i !== index))
  }

  const moveStep = (index: number, direction: -1 | 1) => {
    setDraftSteps((prev) => {
      const next = [...prev]
      const target = index + direction
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const setStepConfig = (index: number, key: string, value: string) => {
    setDraftSteps((prev) => prev.map((s, i) => (i === index ? { ...s, config: { ...s.config, [key]: value } } : s)))
  }

  const saveWorkflow = () => {
    setSaveError('')
    setSaving(true)
    const steps: Step[] = draftSteps.map((s) => ({ NodeTypeID: s.nodeTypeID, Config: s.config }))
    CompositionService.CreateWorkflow(draftLabel, draftDescription, steps)
      .then(() => {
        setDraftLabel('')
        setDraftDescription('')
        setDraftSteps([])
        refetchWorkflows()
      })
      .catch((err) => setSaveError(String(err)))
      .finally(() => setSaving(false))
  }

  return (
    <div className={styles.runbook} data-testid="composition-view">
      <Heading as="h1">Capability composition</Heading>
      <Text as="p" className={styles.subtitle}>
        Prototype for docs/SPEC.md §3 (ADR-0005): compose a workflow from
        reusable node primitives, configuring each step as you add it —
        composing without configuring isn&apos;t a real workflow. Rendered
        as plain lists, not a canvas, since a canvas isn&apos;t earned yet.
        Workflows persist across restarts; internal/domain/runbook (the
        Runbook page) is untouched.
      </Text>

      <Heading as="h2" variant="small" className={styles.sectionHeading}>
        Node primitives
      </Heading>
      {nodeTypes === null && <Text as="p" className={styles.muted}>Loading…</Text>}
      {nodeTypes !== null && (
        <Stack direction="vertical" gap="condensed">
          {nodeTypes.map((node) => (
            <div key={node.ID} className={styles.card} data-testid="node-type-row">
              <Stack direction="horizontal" justify="space-between" align="start" gap="normal">
                <div>
                  <Text weight="semibold">{node.Label}</Text>
                  <Text as="p" size="small" className={styles.muted}>{node.Description}</Text>
                </div>
                <Label variant={KIND_VARIANT[node.Kind] ?? 'secondary'} size="small">{node.Kind}</Label>
              </Stack>
            </div>
          ))}
        </Stack>
      )}

      <Heading as="h2" variant="small" className={styles.sectionHeading}>
        New workflow
      </Heading>
      <div className={styles.card} data-testid="new-workflow-form">
        <Stack direction="vertical" gap="condensed">
          <FormControl>
            <FormControl.Label>Label</FormControl.Label>
            <TextInput value={draftLabel} onChange={(e) => setDraftLabel(e.target.value)} placeholder="My workflow" block />
          </FormControl>
          <FormControl>
            <FormControl.Label>Description</FormControl.Label>
            <Textarea value={draftDescription} onChange={(e) => setDraftDescription(e.target.value)} rows={2} block />
          </FormControl>

          {draftSteps.map((step, i) => {
            const nt = nodeById(step.nodeTypeID)
            return (
              <div key={i} className={styles.card} data-testid="draft-step-row">
                <Stack direction="horizontal" justify="space-between" align="start" gap="normal">
                  <Text weight="semibold">{nt?.Label ?? step.nodeTypeID}</Text>
                  <Stack direction="horizontal" gap="condensed">
                    <IconButton icon={ArrowUpIcon} aria-label="Move step up" size="small" variant="invisible" disabled={i === 0} onClick={() => moveStep(i, -1)} />
                    <IconButton icon={ArrowDownIcon} aria-label="Move step down" size="small" variant="invisible" disabled={i === draftSteps.length - 1} onClick={() => moveStep(i, 1)} />
                    <IconButton icon={TrashIcon} aria-label="Remove step" size="small" variant="invisible" onClick={() => removeStep(i)} />
                  </Stack>
                </Stack>
                {(nt?.ConfigFields ?? []).map((field) => (
                  <FormControl key={field.Key} className={styles.stepConfigField}>
                    <FormControl.Label>{field.Label}</FormControl.Label>
                    {field.Description && <FormControl.Caption>{field.Description}</FormControl.Caption>}
                    <Textarea
                      value={step.config[field.Key] ?? ''}
                      onChange={(e) => setStepConfig(i, field.Key, e.target.value)}
                      rows={3}
                      block
                      data-testid="step-config-field"
                    />
                  </FormControl>
                ))}
              </div>
            )
          })}

          <Stack direction="horizontal" gap="condensed" align="center">
            <Select value={addNodeTypeID} onChange={(e) => setAddNodeTypeID(e.target.value)} aria-label="Node type to add">
              <Select.Option value="">Add a step…</Select.Option>
              {(nodeTypes ?? []).map((nt) => (
                <Select.Option key={nt.ID} value={nt.ID}>{nt.Label}</Select.Option>
              ))}
            </Select>
            <Button leadingVisual={PlusIcon} onClick={addStep} disabled={!addNodeTypeID} size="small">Add step</Button>
          </Stack>

          {saveError && <Text as="p" size="small" className={styles.error}>{saveError}</Text>}
          <Stack direction="horizontal">
            <Button
              variant="primary"
              onClick={saveWorkflow}
              disabled={saving || !draftLabel.trim() || draftSteps.length === 0}
              data-testid="save-workflow"
            >
              {saving ? 'Saving…' : 'Save workflow'}
            </Button>
          </Stack>
        </Stack>
      </div>

      <Heading as="h2" variant="small" className={styles.sectionHeading}>
        Workflows
      </Heading>
      {workflows === null && <Text as="p" className={styles.muted}>Loading…</Text>}
      {workflows !== null && (
        <Stack direction="vertical" gap="condensed">
          {workflows.map((wf) => (
            <div key={wf.ID} className={styles.card} data-testid="workflow-row">
              <Stack direction="horizontal" justify="space-between" align="start" gap="normal">
                <div>
                  <Stack direction="horizontal" gap="condensed" align="center">
                    <Text weight="semibold">{wf.Label}</Text>
                    {wf.BuiltIn && <Label variant="secondary" size="small">built-in</Label>}
                  </Stack>
                  <Text as="p" size="small" className={styles.muted}>{wf.Description}</Text>
                </div>
                <Stack direction="horizontal" gap="condensed">
                  <Button onClick={() => run(wf.ID)} disabled={runningId === wf.ID} size="small">
                    {runningId === wf.ID ? 'Running…' : 'Run'}
                  </Button>
                  {!wf.BuiltIn && (
                    <IconButton icon={TrashIcon} aria-label={`Delete ${wf.Label}`} size="small" variant="invisible" onClick={() => removeWorkflow(wf.ID)} />
                  )}
                </Stack>
              </Stack>

              <Stack direction="vertical" gap="condensed" className={styles.stepChain}>
                {(wf.Steps ?? []).map((step, i) => {
                  const nt = nodeById(step.NodeTypeID)
                  const configEntries = Object.entries(step.Config ?? {})
                  return (
                    <Stack key={i} direction="horizontal" align="start" gap="condensed">
                      {i > 0 && <Text className={styles.muted}>→</Text>}
                      <Token text={nt?.Label ?? step.NodeTypeID} size="large" />
                      {configEntries.length > 0 && (
                        <Text size="small" className={styles.muted}>
                          {configEntries.map(([k, v]) => `${k}: ${(v ?? '').slice(0, 40)}${(v ?? '').length > 40 ? '…' : ''}`).join(', ')}
                        </Text>
                      )}
                    </Stack>
                  )
                })}
              </Stack>

              {errors[wf.ID] && (
                <Text as="p" size="small" className={styles.error}>{errors[wf.ID]}</Text>
              )}
              {results[wf.ID] !== undefined && !errors[wf.ID] && (
                <pre className={styles.result}>{results[wf.ID]}</pre>
              )}
            </div>
          ))}
        </Stack>
      )}
    </div>
  )
}

export default CompositionView
