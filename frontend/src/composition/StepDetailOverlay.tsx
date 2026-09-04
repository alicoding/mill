import { useTranslation } from 'react-i18next'
import { Dialog } from '@primer/react'
import type { AttributeDef, NodeType } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import type { CanvasNode } from './canvasStore'
import { useHotkeyCapture } from './hotkeyCapture'
import { useLatestRunDetail } from './useLatestRunStep'
import { NodeConfigFields } from './NodeConfigFields'
import { StepDetailDataPane } from './StepDetailDataPane'
import styles from './StepDetailOverlay.module.css'

interface StepDetailOverlayProps {
  node: CanvasNode
  workflowId: string
  attrs: AttributeDef[]
  nodeType: NodeType | undefined
  sameKindNodeTypes: NodeType[]
  hasWorkflow: boolean
  hotkeyCapture: ReturnType<typeof useHotkeyCapture>
  readOnly: boolean
  onChangeType: (newType: NodeType) => void
  onConfigChange: (key: string, value: string) => void
  onClose: () => void
}

// The large step-detail surface (docs/goals/0058's owner-picked
// verdict): a selected step's configuration alongside its latest
// recorded input/output, opened from a canvas double-click or the
// sidebar's own expand affordance (NodeInspector.tsx) -- the sidebar
// stays for quick glances, this is for actually working the data.
//
// Built from Primer's own Dialog rather than a hand-rolled fullscreen
// overlay: checked directly against the installed version's
// Dialog.d.ts, `width` documents accepting "any valid CSS width value
// (e.g. '400px', '80rem')", not just its small/medium/large/xlarge
// presets -- confirmed in Dialog.js too (a non-preset width sets
// --dialog-width directly, clamped only by the component's own
// max-width: calc(100dvw - 64px)). Its widest PRESET (xlarge, 640px) is
// too narrow for three real panes side by side, but the custom-width
// escape hatch is still Dialog's own supported API, so this stays
// "Primer's Dialog family at its largest supported size" rather than a
// fallback -- Esc/backdrop-click/close-button and focus-trapping all
// stay the kit's own behavior, per frontend.md.
export function StepDetailOverlay({ node, workflowId, attrs, nodeType, sameKindNodeTypes, hasWorkflow, hotkeyCapture, readOnly, onChangeType, onConfigChange, onClose }: StepDetailOverlayProps) {
  const { t } = useTranslation('composition')
  // Always enabled while mounted -- this component only mounts once the
  // overlay is actually open (CompositionCanvas.tsx), so there's no
  // separate "is it open" gate to thread through.
  const { detail } = useLatestRunDetail(workflowId || undefined, true)
  const step = detail?.steps?.find((s) => s.nodeID === node.id)
  const emptyMessage = t('stepDetailOverlay.emptyData')

  return (
    <Dialog
      title={t('stepDetailOverlay.title', { label: node.data.label })}
      onClose={onClose}
      width="min(1400px, calc(100vw - 64px))"
      height="auto"
      data-component="step-detail-overlay"
    >
      <div className={styles.grid}>
        <div className={styles.pane}>
          <StepDetailDataPane
            heading={t('stepDetailOverlay.input')}
            payload={step?.input ?? ''}
            attributes={step?.inputAttributes}
            emptyMessage={emptyMessage}
            testId="step-detail-input"
          />
        </div>
        <div className={styles.pane}>
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
        </div>
        <div className={styles.pane}>
          <StepDetailDataPane
            heading={t('stepDetailOverlay.output')}
            payload={step?.output ?? ''}
            attributes={step?.outputAttributes}
            emptyMessage={emptyMessage}
            testId="step-detail-output"
          />
        </div>
      </div>
    </Dialog>
  )
}
