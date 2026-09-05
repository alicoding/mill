import { useTranslation } from 'react-i18next'
import { Stack, Text } from '@primer/react'
import type { RunStep } from '../shared/bindings'
import { OutputViewer } from '../shared/OutputViewer'
import { shapeForNodeType } from '../shared/payloadShape'
import { useAppStore } from '../shared/store'
import styles from '../shared/ListCard.module.css'

// Per-step input/output data for the node currently selected on the
// live-run canvas (docs/adr/0031 items 3/5: "clicking any executed/
// paused node shows that step's input and output for the selected
// run"), presented through the shared output viewer (goal 0326) rather
// than as text.
export function NodeExecutionSection({ step }: { step: RunStep | undefined }) {
  const { t } = useTranslation('composition')
  const nodeTypes = useAppStore((s) => s.nodeTypes)
  if (!step) return null
  const hasInputAttrs = step.inputAttributes && Object.keys(step.inputAttributes).length > 0
  const hasOutputAttrs = step.outputAttributes && Object.keys(step.outputAttributes).length > 0
  if (!step.input && !hasInputAttrs && !step.output && !hasOutputAttrs) return null
  return (
    <Stack direction="vertical" gap="condensed" data-testid="node-execution-section">
      <Text size="small" weight="semibold">{t('nodeExecutionSection.heading')}</Text>
      {(step.input || hasInputAttrs) && (
        <Stack direction="vertical" gap="condensed">
          <Text size="small" className={styles.muted}>{t('nodeExecutionSection.input')}</Text>
          {step.input && <OutputViewer value={step.input} defaultView="source" site="node-execution-input" testId="node-execution-input" />}
          {hasInputAttrs && (
            <OutputViewer value={step.inputAttributes} shape="json" site="node-execution-input-attrs" testId="node-execution-input-attrs" />
          )}
        </Stack>
      )}
      {(step.output || hasOutputAttrs) && (
        <Stack direction="vertical" gap="condensed">
          <Text size="small" className={styles.muted}>{t('nodeExecutionSection.output')}</Text>
          {step.output && (
            <OutputViewer value={step.output} shape={shapeForNodeType(nodeTypes, step.nodeTypeID)} defaultView="source" site="node-execution-output" testId="node-execution-output" />
          )}
          {hasOutputAttrs && (
            <OutputViewer value={step.outputAttributes} shape="json" site="node-execution-output-attrs" testId="node-execution-output-attrs" />
          )}
        </Stack>
      )}
    </Stack>
  )
}
