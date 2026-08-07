import { useEffect, useState } from 'react'
import { Button, Heading, IconButton, Label, Stack, Text, Token } from '@primer/react'
import { TrashIcon } from '@primer/octicons-react'
import { CompositionService } from '../bindings/github.com/alicoding/mill'
import type { Edge, Node, NodeType, Workflow } from '../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { useAppStore } from './store'
import CompositionCanvas from './CompositionCanvas'
import { KIND_VARIANT } from './nodeKind'
import styles from './RunbookView.module.css'

// A workflow's Nodes/Edges are an unordered graph on the wire -- this
// walks them into the single execution-order chain composition.go's own
// linearOrder (Go) guarantees every saved workflow already forms, purely
// for display (the chip chain below). Not a general graph-execution
// engine, same scope as the backend: a saved workflow that isn't a valid
// chain can't exist (CreateWorkflow validates it via zod before Save,
// ExecuteWorkflow validates it again before Run), so this trusts that
// invariant rather than re-deriving it defensively.
function orderNodes(nodes: Node[] | null, edges: Edge[] | null): Node[] {
  const nodeList = nodes ?? []
  const edgeList = edges ?? []
  if (nodeList.length === 0) return []
  const byId = new Map(nodeList.map((n) => [n.ID, n]))
  const outgoing = new Map(edgeList.map((e) => [e.Source, e.Target]))
  const hasIncoming = new Set(edgeList.map((e) => e.Target))
  const root = nodeList.find((n) => !hasIncoming.has(n.ID))
  if (!root) return nodeList
  const order: Node[] = []
  let current: string | undefined = root.ID
  const visited = new Set<string>()
  while (current && !visited.has(current)) {
    visited.add(current)
    const node = byId.get(current)
    if (!node) break
    order.push(node)
    current = outgoing.get(current)
  }
  return order
}

// A prototype for SPEC.md §3 / ADR-0005 (A2: MCP-tool + control-flow
// nodes; B2's canvas deferral overridden by explicit decision -- see
// docs/adr/0005-capability-composition-node-schema.md's Update section).
// node types and workflows render as plain lists (node primitives, saved
// workflows), with composition itself now authored on CompositionCanvas
// (React Flow), not a list-only form. Workflows here run the same real
// clipboard/markdown capability internal/domain/runbook already ships,
// decomposed into reusable nodes -- internal/domain/runbook itself is
// untouched. Composing a workflow always configures it: a node dropped
// onto the canvas gets its node type's default config immediately,
// editable the moment it's selected -- never a bare, unconfigured
// node-type reference.
function CompositionView() {
  const pushActivity = useAppStore((s) => s.pushActivity)
  const [nodeTypes, setNodeTypes] = useState<NodeType[] | null>(null)
  const [workflows, setWorkflows] = useState<Workflow[] | null>(null)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  const refetchWorkflows = () => {
    CompositionService.Workflows().then((list) => setWorkflows(list ?? [])).catch(console.error)
  }

  useEffect(() => {
    CompositionService.NodeTypes().then((list) => setNodeTypes(list ?? [])).catch(console.error)
    refetchWorkflows()
  }, [])

  const run = (id: string) => {
    const label = workflows?.find((w) => w.ID === id)?.Label ?? id
    setRunningId(id)
    setErrors((prev) => ({ ...prev, [id]: '' }))
    CompositionService.RunWorkflow(id)
      .then((output) => {
        setResults((prev) => ({ ...prev, [id]: output }))
        pushActivity({
          id: crypto.randomUUID(), time: new Date().toLocaleTimeString(), timestamp: Date.now(),
          source: 'composition', actionID: id, label,
          success: true, detail: `completed (${output.length} bytes)`, result: output,
        })
      })
      .catch((err) => {
        setErrors((prev) => ({ ...prev, [id]: String(err) }))
        pushActivity({
          id: crypto.randomUUID(), time: new Date().toLocaleTimeString(), timestamp: Date.now(),
          source: 'composition', actionID: id, label,
          success: false, detail: String(err), result: '',
        })
      })
      .finally(() => setRunningId(null))
  }

  const removeWorkflow = (id: string) => {
    CompositionService.DeleteWorkflow(id).then(refetchWorkflows).catch(console.error)
  }

  return (
    <div data-testid="composition-view">
      <div className={styles.runbook}>
        <Heading as="h1">Capability composition</Heading>
        <Text as="p" className={styles.subtitle}>
          Prototype for docs/SPEC.md §3 (ADR-0005): compose a workflow on a real
          canvas from reusable node primitives, configuring each node as you add
          it — composing without configuring isn&apos;t a real workflow. Built
          ahead of ADR-0005 B2&apos;s original canvas-deferral trigger, by
          explicit decision. Workflows persist across restarts;
          internal/domain/runbook (the Runbook page) is untouched.
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
      </div>

      {nodeTypes !== null && <CompositionCanvas nodeTypes={nodeTypes} onSaved={refetchWorkflows} />}

      <div className={styles.runbook}>
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
                    <Button
                      onClick={() => run(wf.ID)}
                      disabled={runningId === wf.ID}
                      size="small"
                      aria-label={`Run ${wf.Label}`}
                    >
                      {runningId === wf.ID ? 'Running…' : 'Run'}
                    </Button>
                    {!wf.BuiltIn && (
                      <IconButton icon={TrashIcon} aria-label={`Delete ${wf.Label}`} size="small" variant="invisible" onClick={() => removeWorkflow(wf.ID)} />
                    )}
                  </Stack>
                </Stack>

                <Stack direction="vertical" gap="condensed" className={styles.stepChain}>
                  {orderNodes(wf.Nodes, wf.Edges).map((node, i) => {
                    const nt = nodeTypes?.find((n) => n.ID === node.NodeTypeID)
                    const configEntries = Object.entries(node.Config ?? {})
                    return (
                      <Stack key={node.ID} direction="horizontal" align="start" gap="condensed">
                        {i > 0 && <Text className={styles.muted}>→</Text>}
                        <Token text={nt?.Label ?? node.NodeTypeID} size="large" />
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
    </div>
  )
}

export default CompositionView
