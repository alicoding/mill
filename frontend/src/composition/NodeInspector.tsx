import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { IconButton, Link, SegmentedControl, Stack, Text } from '@primer/react'
import { BugIcon, ScreenFullIcon } from '@primer/octicons-react'
import type { TFunction } from 'i18next'
import type { Edge as RFEdge } from '@xyflow/react'
import type { AttributeDef, NodeType } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import type { RunStep } from '../shared/bindings'
import { useAppStore } from '../shared/store'
import type { CanvasNode } from './canvasStore'
import { useHotkeyCapture } from './hotkeyCapture'
import { NodeExecutionSection } from './NodeExecutionSection'
import { NodeConfigFields } from './NodeConfigFields'
import { NodeInspectorSettingsTab } from './NodeInspectorSettingsTab'
import { StepTestSection } from './StepTestSection'
import { DecisionRulesPanel, type BranchRulesActions } from './DecisionRulesPanel'
import { describeConsumes, describeKind } from './payloadKinds'
import { clampTab, hasRunStepData, inspectorTabBadges, inspectorTabsFor, type InspectorTab } from './nodeInspectorTabs'
import { useStepGuardrail } from './useStepGuardrail'
import { useNodeBreakpoint } from './breakpoints'
import listStyles from '../shared/ListCard.module.css'

// The step reference is one page for every step type -- there is no
// per-type docs page to deep-link, and the docs route addresses pages,
// not anchors.
const STEPS_DOCS_PAGE = 'reference/steps.md'

// The "Takes ... - Produces ..." sentence's two halves (ADR-0042
// §4): consumes ["none"] alone reads as "nothing" (describeConsumes's
// own single-entry branch), a passthrough produce reads as its own
// fixed phrase, and "none" alongside other consumed kinds gets the
// "(optional)" suffix -- the payload is accepted but not required.
function ioContractParts(nt: NodeType, t: TFunction<'composition'>): { consumes: string; produced: string } {
  const consumes = nt.Consumes ?? []
  let consumesDesc = describeConsumes(consumes)
  if (consumes.length > 1 && consumes.some((k) => k === 'none')) {
    consumesDesc = `${consumesDesc} ${t('nodeInspector.ioContractOptionalSuffix')}`
  }
  const produced = nt.Produces.passthrough ? t('nodeInspector.ioContractPassthrough') : describeKind(nt.Produces.kind || 'none')
  return { consumes: consumesDesc, produced }
}

// A remembered tab survives re-selecting the SAME step within the
// session; selecting a different one starts at Parameters, since a
// step you have not looked at yet has nothing remembered.
function tabStorageKey(workflowId: string, nodeId: string): string {
  return `mill.inspectorTab.${workflowId}.${nodeId}`
}

function readRememberedTab(key: string, kind: string, hasRunData: boolean): InspectorTab {
  try {
    return clampTab(sessionStorage.getItem(key), kind, hasRunData)
  } catch {
    return 'parameters'
  }
}

interface NodeInspectorProps {
  node: CanvasNode
  // headerActions: controls the host renders in the header row beside
  // Open details (the panel's own Expand/Shrink toggle).
  headerActions?: ReactNode
  workflowId: string
  attrs: AttributeDef[]
  nodeType: NodeType | undefined
  sameKindNodeTypes: NodeType[]
  hasWorkflow: boolean
  hotkeyCapture: ReturnType<typeof useHotkeyCapture>
  // This node's recorded step data on the run currently displayed on
  // this canvas, if any (docs/adr/0031 items 3/5) -- undefined when no
  // run is displayed, or this node hasn't executed (yet).
  runStep?: RunStep
  readOnly: boolean
  // Opens the large step-detail overlay for this same node
  // (docs/goals/0058) -- the sidebar's own expand affordance, next to
  // the canvas double-click that does the same thing.
  onOpenDetail: () => void
  onChangeType: (newType: NodeType) => void
  onConfigChange: (key: string, value: string) => void
  // Branch-node-only (docs/goals/0173): every canvas edge (the Rules
  // panel filters to this node's own outgoing edges), the pending
  // "Add rule" claim count for this node, per-edge inline validation
  // messages, and the panel's grouped mutation callbacks. Unused for
  // every other node kind.
  edges: RFEdge[]
  pendingRuleCount: number
  issuesByEdgeId: Record<string, string>
  branchRuleActions: BranchRulesActions
}

// The sidebar half of step inspection, disclosed in three tiers (goal
// 0327): Parameters (what the step is and does), Settings (how it
// behaves -- approval, rules, breakpoint), Test (try it, and this
// run's data), over a footer carrying the step's I/O contract and a
// door to the step reference. At most two levels: the tab strip, and
// whatever a field's own editor opens.
//
// The tab bodies are the same pieces as before -- NodeConfigFields
// (the generic ConfigField rendering, docs/goals/0058),
// NodeInspectorSettingsTab, StepTestSection, NodeExecutionSection --
// re-tiered rather than rewritten. The step-detail overlay
// (StepDetailOverlay.tsx) renders the SAME NodeConfigFields at a
// workable size instead of forking a second config form.
export function NodeInspector({ node, headerActions, workflowId, attrs, nodeType, sameKindNodeTypes, hasWorkflow, hotkeyCapture, runStep, readOnly, onOpenDetail, onChangeType, onConfigChange, edges, pendingRuleCount, issuesByEdgeId, branchRuleActions }: NodeInspectorProps) {
  const { t } = useTranslation('composition')
  const kind = node.data.kind
  const hasRunData = hasRunStepData(runStep)
  const tabs = inspectorTabsFor(kind, hasRunData)
  const storageKey = tabStorageKey(workflowId, node.id)
  const [tab, setTabState] = useState<InspectorTab>(() => readRememberedTab(storageKey, kind, hasRunData))
  const setTab = (next: InspectorTab) => {
    setTabState(next)
    try {
      sessionStorage.setItem(storageKey, next)
    } catch {
      // A blocked sessionStorage costs the memory, never the tab switch.
    }
  }
  // A tab can stop being offered while it is showing (a run deselected
  // takes a trigger's Test tab with it) -- fall back rather than render
  // an empty body.
  const activeTab = tabs.includes(tab) ? tab : 'parameters'

  const showGuardrail = !!workflowId && kind !== 'trigger' && kind !== 'decision'
  const { verdict, rules, refreshRules } = useStepGuardrail(workflowId, node.id, showGuardrail)
  const breakpoint = useNodeBreakpoint(node.id)
  const badges = inspectorTabBadges({ ruleCount: rules.length, breakpointSet: breakpoint.isSet, runStep })

  const tabLabel: Record<InspectorTab, string> = {
    parameters: t('nodeInspector.tabs.parameters'),
    settings: t('nodeInspector.tabs.settings'),
    test: t('nodeInspector.tabs.test'),
  }

  return (
    <Stack direction="vertical" gap="condensed">
      <Stack direction="horizontal" justify="end" gap="condensed">
        {headerActions}
        <IconButton
          icon={ScreenFullIcon}
          aria-label={t('nodeInspector.openStepDetail')}
          size="small"
          variant="invisible"
          data-testid="open-step-detail"
          onClick={onOpenDetail}
        />
      </Stack>

      <SegmentedControl
        aria-label={t('nodeInspector.tabs.ariaLabel')}
        size="small"
        fullWidth
        data-testid="inspector-tabs"
        onChange={(i) => setTab(tabs[i] ?? 'parameters')}
      >
        {tabs.map((id) => (
          <SegmentedControl.Button
            key={id}
            selected={activeTab === id}
            count={id === 'settings' ? badges.settingsCount : id === 'test' ? badges.testCount : undefined}
            leadingVisual={id === 'settings' && badges.settingsBreakpoint ? BugIcon : undefined}
            data-testid={`inspector-tab-${id}`}
            data-breakpoint={id === 'settings' ? String(badges.settingsBreakpoint) : undefined}
          >
            {tabLabel[id]}
          </SegmentedControl.Button>
        ))}
      </SegmentedControl>

      {activeTab === 'parameters' && (
        <Stack direction="vertical" gap="condensed" data-testid="inspector-tab-panel-parameters">
          <NodeConfigFields
            node={node}
            attrs={attrs}
            nodeType={nodeType}
            sameKindNodeTypes={sameKindNodeTypes}
            hasWorkflow={hasWorkflow}
            hotkeyCapture={hotkeyCapture}
            readOnly={readOnly}
            onChangeType={onChangeType}
            onConfigChange={onConfigChange}
          />
          {kind === 'decision' && (
            <DecisionRulesPanel
              nodeId={node.id}
              edges={edges}
              attrs={attrs}
              readOnly={readOnly}
              pendingCount={pendingRuleCount}
              issuesByEdgeId={issuesByEdgeId}
              {...branchRuleActions}
            />
          )}
        </Stack>
      )}

      {activeTab === 'settings' && (
        <NodeInspectorSettingsTab
          nodeId={node.id}
          showGuardrail={showGuardrail}
          verdict={verdict}
          rules={rules}
          onRulesChanged={refreshRules}
        />
      )}

      {activeTab === 'test' && (
        <Stack direction="vertical" gap="normal" data-testid="inspector-tab-panel-test">
          <StepTestSection node={node} workflowId={workflowId} runStep={runStep} />
          <NodeExecutionSection step={runStep} />
        </Stack>
      )}

      {nodeType && (
        <Stack direction="horizontal" gap="condensed" align="center" wrap="wrap" data-testid="inspector-footer">
          <Text size="small" className={listStyles.muted} data-testid="inspector-io-contract">
            {t('nodeInspector.ioContract', ioContractParts(nodeType, t))}
          </Text>
          <Link
            href="#"
            data-testid="inspector-docs-link"
            onClick={(e) => {
              e.preventDefault()
              useAppStore.getState().setView({ kind: 'docs', page: STEPS_DOCS_PAGE })
            }}
          >
            <Text size="small">{t('nodeInspector.docsLink')}</Text>
          </Link>
        </Stack>
      )}
    </Stack>
  )
}
