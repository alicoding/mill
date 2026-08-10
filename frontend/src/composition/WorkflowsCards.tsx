import { Button, IconButton, Label, Stack, Text, Token } from '@primer/react'
import { DownloadIcon, PencilIcon, TrashIcon } from '@primer/octicons-react'
import type { Edge, Node, NodeType, Workflow } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { TriggerRowLabel } from './TriggerRowLabel'
import { findRootNode } from './triggerRowInfo'
import { hasDraftDrift } from './draftDrift'
import styles from '../shared/ListCard.module.css'

// The Workflows list's card view -- extracted from CompositionView.tsx
// (with its orderNodes display helper) as the mirror of
// WorkflowsTable.tsx once the cards/table split pushed that file past
// the 500-line limit. Same actions, same handlers; presentation only.

// A workflow's Nodes/Edges are an unordered graph on the wire -- this
// walks them into the single execution-order chain composition.go's own
// linearOrder (Go) guarantees every saved workflow already forms, purely
// for display (the chip chain below). Not a general graph-execution
// engine, same scope as the backend: a saved workflow that isn't a valid
// chain can't exist (CreateWorkflow/UpdateWorkflow validate it via zod
// before Save, ExecuteWorkflow validates it again before Run), so this
// trusts that invariant rather than re-deriving it defensively.
// findRootNode (triggerRowInfo.ts) -- shared with TriggerRowLabel.tsx's
// own trigger-derived row label (docs/goals/0006) -- supplies the root;
// this only adds the rest-of-chain walk display needs on top of it.
function orderNodes(nodes: Node[] | null, edges: Edge[] | null): Node[] {
  const nodeList = nodes ?? []
  const edgeList = edges ?? []
  const root = findRootNode(nodeList, edgeList)
  if (!root) return nodeList
  const outgoing = new Map(edgeList.map((e) => [e.Source, e.Target]))
  const order: Node[] = []
  let current: string | undefined = root.ID
  const visited = new Set<string>()
  const byId = new Map(nodeList.map((n) => [n.ID, n]))
  while (current && !visited.has(current)) {
    visited.add(current)
    const node = byId.get(current)
    if (!node) break
    order.push(node)
    current = outgoing.get(current)
  }
  return order
}

export function WorkflowsCards({
  workflows, nodeTypes, runningId, errors, results, armedWorkflows, publishingId,
  onRun, onEdit, onExport, onDelete, onPublish, onHotkeyChanged,
}: {
  workflows: Workflow[]
  nodeTypes: NodeType[] | null
  runningId: string | null
  errors: Record<string, string>
  results: Record<string, string>
  // TriggerService.ArmedWorkflows(), keyed by workflow ID (docs/goals/
  // 0006-trigger-aware-workflows-list.md) -- fetched once by
  // CompositionView, not recomputed per row.
  armedWorkflows: Record<string, boolean | undefined>
  publishingId: string | null
  onRun: (id: string) => void
  onEdit: (id: string) => void
  onExport: (id: string, label: string) => void
  onDelete: (id: string) => void
  onPublish: (id: string) => void
  onHotkeyChanged: () => void
}) {
  return (
    <Stack direction="vertical" gap="condensed">
      {workflows.map((wf) => {
        // trigger-callable rows: only ever run via another workflow's
        // Child Workflow node (docs/SPEC.md §3.3/ADR-0010) -- a primary
        // Run button here was the exact incoherence the goal names.
        // Demoted to a small secondary "Test" action, same treatment as
        // WorkflowsTable.tsx.
        const isCallable = findRootNode(wf.Nodes, wf.Edges)?.NodeTypeID === 'trigger-callable'
        const runTitle = hasDraftDrift(wf)
          ? 'Test run of the draft — differs from the published version.'
          : 'Test run of the draft.'
        return (
          <div key={wf.ID} className={styles.card} data-testid="workflow-row">
            <Stack direction="horizontal" justify="space-between" align="start" gap="normal">
              <div>
                <Stack direction="horizontal" gap="condensed" align="center">
                  <Text weight="semibold">{wf.Label}</Text>
                  {wf.BuiltIn && <Label variant="secondary" size="small">built-in</Label>}
                  {/* Lifecycle badges (docs/adr/0021): live version, or a
                      never-published draft; disabled pauses triggers. */}
                  {wf.PublishedVersion > 0
                    ? <Label variant="success" size="small">v{wf.PublishedVersion} live</Label>
                    : <Label variant="attention" size="small">draft</Label>}
                  {wf.Disabled && <Label variant="severe" size="small">disabled</Label>}
                </Stack>
                <Text as="p" size="small" className={styles.muted}>{wf.Description}</Text>
                <div className={styles.stepConfigField}>
                  <TriggerRowLabel
                    workflow={wf}
                    armed={armedWorkflows[wf.ID] === true}
                    publishing={publishingId === wf.ID}
                    onPublish={onPublish}
                    onHotkeyChanged={onHotkeyChanged}
                  />
                </div>
              </div>
              <Stack direction="horizontal" gap="condensed">
                {isCallable ? (
                  <Button
                    onClick={() => onRun(wf.ID)}
                    disabled={runningId === wf.ID}
                    size="small"
                    variant="invisible"
                    aria-label={`Test ${wf.Label}`}
                    title={runTitle}
                    data-testid="callable-test-run"
                  >
                    {runningId === wf.ID ? 'Running…' : 'Test'}
                  </Button>
                ) : (
                  <Button
                    onClick={() => onRun(wf.ID)}
                    disabled={runningId === wf.ID}
                    size="small"
                    aria-label={`Run ${wf.Label}`}
                    title={runTitle}
                  >
                    {runningId === wf.ID ? 'Running…' : 'Run'}
                  </Button>
                )}
                {/* No !wf.BuiltIn guard -- every workflow, seeded or
                    user-composed, is ordinary and fully editable/
                    deletable from the moment it exists (docs/SPEC.md
                    §2.2's Update note). BuiltIn only drives the
                    informational "built-in" badge above. */}
                <IconButton
                  icon={PencilIcon}
                  aria-label={`Edit ${wf.Label}`}
                  size="small"
                  variant="invisible"
                  disabled={nodeTypes === null}
                  onClick={() => onEdit(wf.ID)}
                />
                <IconButton
                  icon={DownloadIcon}
                  aria-label={`Export ${wf.Label}`}
                  size="small"
                  variant="invisible"
                  onClick={() => onExport(wf.ID, wf.Label)}
                />
                <IconButton icon={TrashIcon} aria-label={`Delete ${wf.Label}`} size="small" variant="invisible" onClick={() => onDelete(wf.ID)} />
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
        )
      })}
    </Stack>
  )
}
