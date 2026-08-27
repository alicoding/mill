import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Banner, Button, Label, Stack, Text } from '@primer/react'
import { StopIcon } from '@primer/octicons-react'
import type { CommandBlockPreview } from './bindings'
import type { CodingLoopStepProgressEvent } from './codingLoopTypes'
import { CODING_LOOP_STUCK_THRESHOLD_MS } from './codingLoopConstants'
import styles from './CodingLoopSurface.module.css'

interface Props {
  preview: CommandBlockPreview
  stepProgress: Record<number, CodingLoopStepProgressEvent>
  lastProgressAt: number | null
  startError: string | null
  onCancel: () => void
}

type StepDisplayStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

function elapsedLabel(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  return `${seconds}s`
}

// The Running state (docs/goals/0240 S1's design contract): the same
// list becomes live -- per-step state, the running step's output tail,
// elapsed time, a visible "stuck for Ns" once quiet too long. Never
// disappears into the background on its own; closing the surface
// leaves the real run going (Activity/the seed's own completion
// notification cover the rest -- see useCodingLoopRun's mount-time
// re-adopt for what happens if this door reopens while it's still
// running).
export function CodingLoopRunningState({ preview, stepProgress, lastProgressAt, startError, onCancel }: Props) {
  const { t } = useTranslation('app')
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const steps = preview.steps ?? []
  const runningIndex = steps.find((s) => stepProgress[s.index]?.status === 'running')?.index
  const stuckMs = lastProgressAt != null && runningIndex != null ? now - lastProgressAt : 0
  const isStuck = stuckMs >= CODING_LOOP_STUCK_THRESHOLD_MS

  return (
    <Stack gap="condensed" className={styles.panel} data-testid="coding-loop-running">
      <ol className={styles.stepList}>
        {steps.map((step) => {
          const live = stepProgress[step.index]
          const status: StepDisplayStatus = (live?.status as StepDisplayStatus | undefined) ?? 'pending'
          return (
            <li key={step.index} className={styles.stepRow} data-testid={`coding-loop-step-${step.index}`} data-status={status}>
              <Label size="small" variant={statusVariant(status)}>{t(`codingLoop.running.status.${status}`)}</Label>
              <code className={styles.stepText}>{step.text}</code>
              {status === 'running' && live?.outputTail && (
                <pre className={styles.outputTail} data-testid={`coding-loop-step-${step.index}-tail`}>{live.outputTail}</pre>
              )}
            </li>
          )
        })}
      </ol>

      {runningIndex != null && (
        <Text as="p" size="small" data-testid="coding-loop-running-elapsed">
          {isStuck
            ? t('codingLoop.running.stuckFor', { seconds: Math.round(stuckMs / 1000) })
            : t('codingLoop.running.elapsed', { elapsed: elapsedLabel(stuckMs) })}
        </Text>
      )}

      {startError && (
        <Banner variant="critical" title={t('codingLoop.running.approvalFailedTitle')} description={startError} data-testid="coding-loop-running-error" />
      )}

      <Stack direction="horizontal" gap="condensed" className={styles.actions}>
        <Button leadingVisual={StopIcon} onClick={onCancel} data-testid="coding-loop-cancel">
          {t('codingLoop.running.cancel')}
        </Button>
      </Stack>
    </Stack>
  )
}

function statusVariant(status: StepDisplayStatus): 'default' | 'accent' | 'success' | 'danger' | 'attention' {
  switch (status) {
    case 'running':
      return 'accent'
    case 'done':
      return 'success'
    case 'failed':
      return 'danger'
    case 'skipped':
      return 'attention'
    default:
      return 'default'
  }
}
