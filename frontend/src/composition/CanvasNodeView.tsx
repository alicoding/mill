import { Handle, Position as RFPosition } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { Text } from '@primer/react'
import { AlertFillIcon, ShieldIcon } from '@primer/octicons-react'
import type { CanvasNode } from './canvasStore'
import { KIND_ICON, KIND_ICON_BG, KIND_LABEL } from './nodeKind'
import { WorkflowHoverPreview } from './WorkflowHoverPreview'
import { useNodeRunStatus, type NodeRunStatus } from './liveRunState'
import styles from './CompositionCanvas.module.css'

// Live run state (docs/SPEC.md §3.8's authoring-style direction, item
// #2): a small-caps status tag next to the existing kind/label text,
// same visual language as canvasNodeKind. The card's left-edge color is
// driven purely by the `data-run-status` attribute in CSS (see
// CompositionCanvas.module.css) rather than a second class-lookup table
// here, so the two mappings (tag text, tag/edge color) can't drift
// silently out of sync.
const RUN_STATUS_LABEL: Record<NodeRunStatus, string> = {
  done: 'DONE',
  active: 'ACTIVE',
  pending: 'PENDING',
  failed: 'FAILED',
  'awaiting-approval': 'WAITING',
  denied: 'DENIED',
}

// Top/bottom handles, not left/right -- a top-to-bottom chain with each
// edge entering/exiting a node's horizontal center (React Flow's default
// for Top/Bottom handle positions) reads as one orderly column instead
// of the diagonal, easy-to-overlap layout left/right handles produced.
// Every node renders at the same fixed width/height (CANVAS_NODE_WIDTH/
// HEIGHT, canvasConstants.ts -- shared with the elkjs layout call and
// canvasLayout.ts's collision math so everything agrees on the size a
// node actually renders at) regardless of label length -- a uniform
// grid of cards, not size-to-content boxes; long labels truncate with
// an ellipsis instead of stretching the card.
//
// Card shape (icon square + kind label + title stacked beside it) is
// adopted from the reference no-code platform's own node cards; the
// icon/color/kind text is Mill's own (KIND_ICON/KIND_ICON_BG/KIND_LABEL,
// nodeKind.ts) since Mill's node kinds are Capture/Process/Apply, not
// that reference's fuller Input/Decision/Ruleset/... taxonomy.
export function CanvasNodeView({ id, data, selected }: NodeProps<CanvasNode>) {
  const Icon = KIND_ICON[data.kind]
  const runStatus = useNodeRunStatus(id)
  // Trigger nodes have no target handle -- nothing should connect into
  // them, same as n8n's own trigger nodes having no input pin (they're
  // the entry point, not a step something else feeds).
  const isTrigger = data.kind === 'trigger'
  // Terminal nodes (docs/adr/0027) have no SOURCE handle -- a Decision
  // ends the workflow, nothing connects out of it. The mirror-image rule
  // of isTrigger above; both are belt-and-suspenders with
  // isValidConnection (CompositionCanvas.tsx) and ValidateGraph
  // (composition/graph.go) rejecting the same edge shape server-side.
  const isTerminal = data.kind === 'terminal'
  // A child-workflow node with a selected child IS the hover-preview
  // anchor (docs/SPEC.md §3.8, corrected per direct feedback: the
  // preview belongs on the node itself, not only on an Inspector
  // hint) -- hovering the card shows the child's layout, Open jumps
  // into its editor. Drag/select keep working: the anchor wrapper only
  // listens for hover, and every pointer event still bubbles to React
  // Flow's own node wrapper.
  const childWorkflowId = data.nodeTypeID === 'child-workflow' ? (data.config?.workflowId ?? '') : ''
  // Authoring-validation badge (docs/adr/0028): worst severity wins
  // when a node carries both an error and a warning issue -- one badge,
  // not a stack of them, same restraint the guardrail badge already
  // applies (a step is either ask or deny, never both at once).
  const validationIssues = data.validationIssues ?? []
  const validationSeverity = validationIssues.some((i) => i.severity === 'error')
    ? 'error'
    : validationIssues.length > 0
      ? 'warning'
      : undefined
  const card = (
    <div
      className={`${styles.canvasNode} ${selected ? styles.canvasNodeSelected : ''}`}
      data-run-status={runStatus}
    >
      {!isTrigger && <Handle type="target" position={RFPosition.Top} />}
      <div className={styles.canvasNodeIcon} style={{ background: KIND_ICON_BG[data.kind] ?? 'var(--bgColor-neutral-emphasis)' }}>
        {Icon && <Icon size={16} fill="var(--fgColor-onEmphasis)" />}
      </div>
      <div className={styles.canvasNodeText}>
        <Text size="small" className={styles.canvasNodeKind}>{KIND_LABEL[data.kind] ?? data.kind}</Text>
        <Text size="small" weight="semibold" className={styles.canvasNodeLabel} title={data.label}>
          {data.label}
        </Text>
        {data.output ? (
          <Text size="small" className={styles.canvasNodeOutput} title={`Output: ${data.output}`}>
            → {data.output}
          </Text>
        ) : null}
      </div>
      {(data.guardrailEffect === 'ask' || data.guardrailEffect === 'deny') && (
        <span
          className={styles.canvasNodeGuardrail}
          data-testid="canvas-guardrail-badge"
          data-effect={data.guardrailEffect}
          title={data.guardrailEffect === 'deny'
            ? `Denied by guardrail rule${data.guardrailRule ? ` "${data.guardrailRule}"` : ''} — this step will not run`
            : `Asks for approval before running${data.guardrailRule ? ` — ${data.guardrailRule}` : ''}`}
        >
          <ShieldIcon size={12} />
        </span>
      )}
      {validationSeverity && (
        <span
          className={styles.canvasNodeValidation}
          data-testid="node-validation-badge"
          data-severity={validationSeverity}
          title={validationIssues.map((i) => i.message).join('\n')}
        >
          <AlertFillIcon size={12} />
        </span>
      )}
      {runStatus && (
        <span
          className={styles.runStatusTag}
          data-testid="node-run-status"
          data-status={runStatus}
        >
          {RUN_STATUS_LABEL[runStatus]}
        </span>
      )}
      {!isTerminal && <Handle type="source" position={RFPosition.Bottom} />}
    </div>
  )
  if (childWorkflowId !== '') {
    return <WorkflowHoverPreview workflowId={childWorkflowId}>{card}</WorkflowHoverPreview>
  }
  return card
}
