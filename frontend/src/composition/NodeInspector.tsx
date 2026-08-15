import { useTranslation } from 'react-i18next'
import { IconButton, Stack } from '@primer/react'
import { ScreenFullIcon } from '@primer/octicons-react'
import type { AttributeDef, NodeType } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import type { RunStep } from '../shared/bindings'
import type { CanvasNode } from './canvasStore'
import { useHotkeyCapture } from './hotkeyCapture'
import { NodeExecutionSection } from './NodeExecutionSection'
import { NodeConfigFields } from './NodeConfigFields'

interface NodeInspectorProps {
  node: CanvasNode
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
}

// The sidebar half of step inspection: a quick glance at a selected
// step's last-run data plus its configuration, both reused as-is from
// the shared pieces below -- NodeExecutionSection (data) and
// NodeConfigFields (the generic ConfigField rendering, docs/goals/0058).
// The step-detail overlay (StepDetailOverlay.tsx) renders the SAME
// NodeConfigFields at a workable size instead of forking a second
// config form; this component's own job is just the sidebar's
// glance-sized layout plus the affordance to open that overlay.
export function NodeInspector({ node, workflowId, attrs, nodeType, sameKindNodeTypes, hasWorkflow, hotkeyCapture, runStep, readOnly, onOpenDetail, onChangeType, onConfigChange }: NodeInspectorProps) {
  const { t } = useTranslation('composition')
  return (
    <Stack direction="vertical" gap="condensed">
      <Stack direction="horizontal" justify="end">
        <IconButton
          icon={ScreenFullIcon}
          aria-label={t('nodeInspector.openStepDetail')}
          size="small"
          variant="invisible"
          data-testid="open-step-detail"
          onClick={onOpenDetail}
        />
      </Stack>
      <NodeExecutionSection step={runStep} />
      <NodeConfigFields
        node={node}
        workflowId={workflowId}
        attrs={attrs}
        nodeType={nodeType}
        sameKindNodeTypes={sameKindNodeTypes}
        hasWorkflow={hasWorkflow}
        hotkeyCapture={hotkeyCapture}
        readOnly={readOnly}
        onChangeType={onChangeType}
        onConfigChange={onConfigChange}
      />
    </Stack>
  )
}
