import { Handle, Position as RFPosition } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { Text } from '@primer/react'
import { AlertFillIcon, BugIcon, ShieldIcon } from '@primer/octicons-react'
import type { CanvasNode } from './canvasStore'
import { KIND_ICON, KIND_ICON_BG, KIND_LABEL } from './nodeKind'
import { WorkflowHoverPreview } from './WorkflowHoverPreview'
import { useNodePaused, useNodeRunStatus, type NodeRunStatus } from './liveRunState'
import { useNodeBreakpoint } from './breakpoints'
import styles from './CompositionCanvas.module.css'

// Live run state (docs/SPEC.md §3.8's authoring-style direction, item
// #2): a small-caps status tag next to the existing kind/label text,
// same visual language as canvasNodeKind. The card's left-edge color is
// driven purely by the `data-run-status` attribute in CSS (see
// CompositionCanvas.module.css) rather than a second class-lookup table
// here, so the two mappings (tag text, tag/edge color) can't drift
// silently out of sync.
function runStatusLabelFor(t: (key: string) => string): Record<NodeRunStatus, string> {
  return {
    done: t('canvasNodeView.runStatus.done'),
    active: t('canvasNodeView.runStatus.active'),
    pending: t('canvasNodeView.runStatus.pending'),
    failed: t('canvasNodeView.runStatus.failed'),
    'awaiting-approval': t('canvasNodeView.runStatus.awaiting-approval'),
    denied: t('canvasNodeView.runStatus.denied'),
  }
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
// eslint-disable-next-line sonarjs/cognitive-complexity -- legacy complexity grandfathered at gate adoption; pay down when touched (goal 0109 burn-down)
export function CanvasNodeView({ id, data, selected }: NodeProps<CanvasNode>) {
  const { t } = useTranslation('composition')
  const RUN_STATUS_LABEL = runStatusLabelFor(t)
  const Icon = KIND_ICON[data.kind]
  const runStatus = useNodeRunStatus(id)
  const paused = useNodePaused(id)
  const breakpoint = useNodeBreakpoint(id)
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
      data-run-paused={paused ? 'true' : undefined}
      title={data.output ? t('canvasNodeView.outputTitle', { output: data.output }) : undefined}
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
        {data.contractLine ? (
          <Text size="small" className={styles.canvasNodeOutput}>
            {data.contractLine}
          </Text>
        ) : null}
      </div>
      {/* The guardrail shield is suppressed specifically when the
          winning verdict IS the debug breakpoint rule (docs/adr/0031:
          "recognition, not confirmation -- the two must never read as
          one concept") -- the breakpoint dot below is now the single,
          always-accurate signal for "is a breakpoint set here,"
          independent of verdict precedence (goal 0022's Update to the
          ADR: the shield's own guardrailEffect/Source come from
          WorkflowVerdicts' per-node WINNING rule, which a stronger
          policy deny could otherwise hide the debug rule's existence
          behind -- the dot never has that gap, since it reads ground
          truth). */}
      {!(data.guardrailEffect === 'ask' && data.guardrailSource === 'debug') && (data.guardrailEffect === 'ask' || data.guardrailEffect === 'deny') && (
        <span
          className={styles.canvasNodeGuardrail}
          data-testid="canvas-guardrail-badge"
          data-effect={data.guardrailEffect}
          title={data.guardrailEffect === 'deny'
            ? t('canvasNodeView.guardrailDeniedTitle', { ruleSuffix: data.guardrailRule ? t('canvasNodeView.guardrailRuleSuffix', { rule: data.guardrailRule }) : '' })
            : t('canvasNodeView.guardrailAskTitle', { ruleSuffix: data.guardrailRule ? t('canvasNodeView.guardrailAskRuleSuffix', { rule: data.guardrailRule }) : '' })}
        >
          <ShieldIcon size={12} />
        </span>
      )}
      {/* VS Code-gutter-style breakpoint toggle (docs/goals/0022): a
          real button, always rendered (not conditional on being set),
          dim/hollow on card hover when unset, solid when set -- see
          CompositionCanvas.module.css's .canvasNodeBreakpoint for the
          full visual-state rationale. Never inside NodeInspector's own
          read-only <fieldset> (a separate control entirely) -- setting
          a breakpoint is a debug act, not an authoring edit, so it
          stays clickable in BOTH view and edit mode. `nodrag nopan`
          (React Flow's own documented class-based opt-out) keeps a
          click here from starting a card drag or a canvas pan; every
          Trigger/Decision node is excluded, matching the exact same
          exclusion NodeGuardrailSection.tsx's own condition already
          enforced for the Inspector button this replaces. */}
      {!isTrigger && data.kind !== 'decision' && (
        <button
          type="button"
          className={`${styles.canvasNodeBreakpoint} nodrag nopan`}
          data-testid="canvas-breakpoint-toggle"
          data-set={breakpoint.isSet}
          disabled={!breakpoint.enabled || breakpoint.busy}
          title={
            !breakpoint.enabled
              ? t('canvasNodeView.breakpointSaveFirst')
              : breakpoint.isSet
                ? t('canvasNodeView.breakpointSetTitle')
                : t('canvasNodeView.breakpointUnsetTitle')
          }
          onClick={(e) => {
            e.stopPropagation()
            breakpoint.toggle()
          }}
        >
          <BugIcon size={12} />
        </button>
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
