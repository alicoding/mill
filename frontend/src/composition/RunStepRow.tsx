import { useTranslation } from 'react-i18next'
import { Button, Stack, Text } from '@primer/react'
import { BugIcon, CheckCircleIcon, ClockIcon, ShieldIcon, ShieldXIcon, StopIcon, XCircleIcon } from '@primer/octicons-react'
import type { RunDetail, RunStep } from '../shared/bindings'
import { StatusStamp } from '../shared/StatusStamp'
import { OutputViewer } from '../shared/OutputViewer'
import { shapeForNodeType } from '../shared/payloadShape'
import { useAppStore } from '../shared/store'
import styles from '../shared/ListCard.module.css'

const STEP_ICON: Record<string, React.ReactNode> = {
  succeeded: <CheckCircleIcon size={16} fill="var(--fgColor-success)" />,
  failed: <XCircleIcon size={16} fill="var(--fgColor-danger)" />,
  pending: <ClockIcon size={16} fill="var(--fgColor-muted)" />,
  'awaiting-approval': <ShieldIcon size={16} fill="var(--fgColor-attention)" />,
  denied: <ShieldXIcon size={16} fill="var(--fgColor-danger)" />,
  // docs/adr/0026: a cancelled code-execution step is recorded
  // distinctly from an ordinary failure ("cancelled != failed").
  cancelled: <StopIcon size={16} fill="var(--fgColor-muted)" />,
}

// One run's single step row -- split out of WorkflowRunsPanel.tsx
// (CLAUDE.md's 500-line convention) once the copyable-diagnosis button
// (goal 0127 slice 4) pushed that file over the limit. `detail` carries
// the owning run's own identity for the step-error copy payload's
// context lines; RunStepRow never fetches anything itself.
export function RunStepRow({ step, detail, busy, onRetry }: {
  step: RunStep
  detail: RunDetail
  busy: boolean
  onRetry: (nodeID: string) => void
}) {
  const { t } = useTranslation('composition')
  // The step's own declared produce kind (ADR-0042) is what the viewer
  // renders by; nothing here guesses at the payload's bytes.
  const nodeTypes = useAppStore((s) => s.nodeTypes)
  return (
    <Stack direction="horizontal" justify="space-between" align="start" gap="condensed"
      data-testid="run-step" data-node-type-id={step.nodeTypeID}>
      <Stack direction="horizontal" gap="condensed" align="start">
        <span className={styles.icon}>{STEP_ICON[step.status]}</span>
        <div>
          <Stack direction="horizontal" gap="condensed" align="center">
            <Text size="small" weight="semibold">{step.nodeTypeLabel || step.nodeTypeID}</Text>
            {/* A breakpoint/step-mode debug park reads distinctly
                here too (docs/adr/0031 item 2) -- BugIcon, never
                the guardrail shield/wording. */}
            {step.guardrailSource === 'debug' && (
              <StatusStamp variant="identity" data-testid="step-debug-badge">
                <BugIcon size={12} /> {t('workflowRunsPanel.breakpointBadge')}
              </StatusStamp>
            )}
          </Stack>
          {step.guardrailEffect && (
            <Text as="p" size="small" className={styles.muted} data-testid="step-guardrail">
              {t('workflowRunsPanel.guardrailLabel', { effect: step.guardrailEffect, ruleSuffix: step.guardrailRule ? t('workflowRunsPanel.ruleSuffix', { rule: step.guardrailRule }) : '' })}
            </Text>
          )}
          {step.output && (
            <OutputViewer
              value={step.output}
              shape={shapeForNodeType(nodeTypes, step.nodeTypeID)}
              defaultView="source"
              title={step.nodeTypeLabel || step.nodeTypeID}
              site="run-step"
              testId="run-step-output"
            />
          )}
          {step.error && (
            <OutputViewer
              value={step.error}
              shape="error"
              title={step.nodeTypeLabel || step.nodeTypeID}
              site="run-step-error"
              testId="run-step-error"
              context={{
                Workflow: detail.workflowLabel,
                'Workflow ID': detail.workflowID,
                'Run ID': detail.runID,
                Step: step.nodeTypeLabel || step.nodeTypeID,
                'Node type': step.nodeTypeID,
                Status: detail.status,
                Started: detail.startedAt,
                Finished: detail.completedAt,
              }}
            />
          )}
        </div>
      </Stack>
      {/* "Retry", not "redrive": redrive is AWS-specific jargon
          (SQS DLQ / Step Functions); the no-code space this
          product competes in says Retry (n8n) / Replay (Zapier) /
          Resubmit (Power Automate). Code-level RedriveRun/DBOS
          fork naming is untouched -- ADR-0016's code-vs-UI
          naming split, applied again (same class as the
          "idempotency key" -> "Skip duplicate runs" rewrite). */}
      {step.status === 'failed' && (
        <Button size="small" disabled={busy} onClick={() => onRetry(step.nodeID)}>
          {t('workflowRunsPanel.retryFromThisStep')}
        </Button>
      )}
    </Stack>
  )
}
