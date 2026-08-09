import { Button, IconButton, Label, Stack, Text, Token } from '@primer/react'
import { DownloadIcon, PencilIcon, TrashIcon } from '@primer/octicons-react'
import type { Edge, Node, NodeType, Workflow } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
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

export function WorkflowsCards({ workflows, nodeTypes, runningId, errors, results, onRun, onEdit, onExport, onDelete }: {
  workflows: Workflow[]
  nodeTypes: NodeType[] | null
  runningId: string | null
  errors: Record<string, string>
  results: Record<string, string>
  onRun: (id: string) => void
  onEdit: (id: string) => void
  onExport: (id: string, label: string) => void
  onDelete: (id: string) => void
}) {
  return (
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
                onClick={() => onRun(wf.ID)}
                disabled={runningId === wf.ID}
                size="small"
                aria-label={`Run ${wf.Label}`}
              >
                {runningId === wf.ID ? 'Running…' : 'Run'}
              </Button>
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
      ))}
    </Stack>
  )
}
