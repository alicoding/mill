import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Panel } from '@xyflow/react'
import { Button, IconButton, Stack, Text } from '@primer/react'
import { StatusStamp, type StatusStampVariant } from '../shared/StatusStamp'
import { AlertIcon, BugIcon, LockIcon, PlayIcon, ShieldIcon, SkipIcon, StopIcon, XIcon } from '@primer/octicons-react'
import type { AttributeDef } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import type { RunDetail } from '../shared/bindings'
import { ApprovalValuesForm, attrsForPending } from '../shared/ApprovalValuesForm'
import { CopyDiagnosisButton } from '../shared/CopyDiagnosisButton'
import { runCommand } from '../shared/commands'
import type { CommandContext } from '../shared/commandContext'
import { parkControls, truncate, type BarState } from './liveRunState'
import { VaultWaitActions } from '../shared/VaultWaitActions'
import styles from './CompositionCanvas.module.css'
import runbookStyles from '../shared/ListCard.module.css'

// The canvas's run dock (goal 0328): a React Flow panel DOCKED at the
// top of the board, carrying whatever the run currently displayed here
// is doing -- in flight, paused, unrecoverable, or finished. The debugger
// convention this follows puts the pause controls above the graph, in a
// fixed order with the resume action first, so the button under the
// pointer never depends on which kind of pause happened.
//
// Split out of LiveRunControls.tsx, which keeps the Run entry point:
// that file crossed the 500-line limit once the dock grew its command
// wiring, and the two halves have no shared state.

const FINISHED_VARIANT: Record<string, StatusStampVariant> = {
  SUCCESS: 'success',
  ERROR: 'danger',
  CANCELLED: 'neutral',
  MAX_RECOVERY_ATTEMPTS_EXCEEDED: 'danger',
}

// The command each debug control fires. Named here rather than inline so
// the state machine above and the wiring below can never disagree.
const COMMAND_FOR: Record<'continue' | 'step' | 'stop', string> = {
  continue: 'run.continue',
  step: 'run.step',
  stop: 'run.stop',
}

export function RunStateDock({
  barState, attrs, runDetail, resolveErrorKey, onResolve, onDismiss,
}: {
  barState: BarState | null
  // The owning workflow's declared Attributes -- what a debug park's
  // edit-and-resume form offers to override.
  attrs: AttributeDef[]
  // The displayed run's full detail: the run/workflow ids a park's
  // commands act on, and the copyable diagnosis context of a finished
  // run. Null for a pre-flight REFUSED start (no run was ever created).
  runDetail: RunDetail | null
  // The i18n key for a refused guardrail decision, empty when the last
  // one landed. A debug park's controls run through the command
  // registry instead, whose own failure notice carries the same wording.
  resolveErrorKey: string
  onResolve: (nodeID: string, approve: boolean, continueRun?: boolean, values?: Record<string, string>) => void
  onDismiss: () => void
}) {
  const { t } = useTranslation('composition')
  // The interrupted caption, Dismiss and the refusal copy live in the
  // `common` namespace: the Runs panel's own parked bar renders exactly
  // the same strings (shared/approvalResolution.ts).
  const { t: tc } = useTranslation('common')
  const parkedNodeID = barState?.mode === 'parked' ? barState.pending.nodeID : null
  const [editValues, setEditValues] = useState<Record<string, string>>({})
  // A fresh park (a different node, or the same node on a later run)
  // starts with a clean edit form, not the previous park's leftover
  // values.
  useEffect(() => {
    setEditValues({})
  }, [parkedNodeID])

  if (!barState) return null
  return (
    <Panel position="top-center">
      <div className={styles.currentStepBar} data-testid="run-state-dock">
        {barState.mode === 'in-flight' && (
          <Stack direction="horizontal" gap="condensed" align="center">
            <Text size="small" className={styles.currentStepBarLabel}>{t('liveRunControls.currentStep')}</Text>
            <Text size="small" weight="semibold">{barState.activeStepLabel}</Text>
            <Text size="small" className={runbookStyles.muted}>{t('running')}</Text>
          </Stack>
        )}
        {barState.mode === 'parked' && (() => {
          const pending = barState.pending
          const isDebug = pending.source === 'debug'
          const isStepped = pending.stepped
          const step = pending.nodeTypeLabel || pending.nodeTypeID
          const controls = parkControls(pending.source ?? '', isStepped, pending.reason ?? '')
          const ctx: CommandContext = {
            kind: 'run',
            runId: runDetail?.runID ?? '',
            workflowId: runDetail?.workflowID,
            nodeId: pending.nodeID,
            values: editValues,
          }
          if (controls.includes('unlock')) {
            return (
              <Stack direction="vertical" gap="condensed">
                <Stack direction="horizontal" gap="condensed" align="center">
                  <LockIcon size={16} fill="var(--fgColor-attention)" />
                  <Text size="small" weight="semibold" data-testid="run-state-dock-label">{tc('vaultWait.title')}</Text>
                </Stack>
                <VaultWaitActions ctx={ctx} testIdPrefix="canvas-vault-wait" />
              </Stack>
            )
          }
          return (
            <Stack direction="vertical" gap="condensed">
              <Stack direction="horizontal" gap="condensed" align="center">
                {isDebug ? <BugIcon size={16} fill="var(--fgColor-done)" /> : <ShieldIcon size={16} fill="var(--fgColor-attention)" />}
                <Text size="small" weight="semibold" data-testid="run-state-dock-label">
                  {isDebug
                    ? (isStepped ? t('runStateDock.pausedAt', { step }) : t('runStateDock.pausedAtBreakpoint', { step }))
                    : t('liveRunControls.awaitingApprovalNodeLabel', { node: step })}
                </Text>
              </Stack>
              {pending.payload && (
                <Text size="small" className={runbookStyles.muted}>{truncate(pending.payload, 120)}</Text>
              )}
              {/* Edit-and-resume, debug parks only -- an ordinary policy
                  ask isn't an authoring surface for the run's own data. */}
              {isDebug && (
                <ApprovalValuesForm
                  attrs={attrsForPending(attrs, pending.inputAttributes)}
                  values={editValues}
                  onChange={(key, value) => setEditValues((prev) => ({ ...prev, [key]: value }))}
                  label={t('editBeforeResuming')}
                />
              )}
              <Stack direction="horizontal" gap="condensed">
                {controls.map((control) => {
                  if (control === 'approve') {
                    return (
                      <Button key={control} size="small" variant="primary" data-testid="canvas-approve-step" onClick={() => onResolve(pending.nodeID, true)}>
                        {t('liveRunControls.approve')}
                      </Button>
                    )
                  }
                  if (control === 'deny') {
                    return (
                      <Button key={control} size="small" variant="danger" data-testid="canvas-deny-step" onClick={() => onResolve(pending.nodeID, false)}>
                        {t('deny')}
                      </Button>
                    )
                  }
                  // The dock's own wording, not the command's palette
                  // label: a button beside "Paused at X" needs no second
                  // mention of what it stops. Continue reads "Resume" at
                  // a breakpoint -- there is no stepping session to
                  // continue, only a stopped run to let go.
                  const label = control === 'continue' ? (isStepped ? t('continue') : t('resume')) : t(control)
                  return (
                    <Button
                      key={control}
                      size="small"
                      variant={control === 'stop' ? 'danger' : control === 'continue' ? 'primary' : 'default'}
                      leadingVisual={control === 'stop' ? StopIcon : control === 'step' ? SkipIcon : PlayIcon}
                      data-testid={control === 'stop' ? 'canvas-stop-step' : control === 'step' ? 'canvas-step' : 'canvas-resume-step'}
                      onClick={() => { void runCommand(COMMAND_FOR[control], ctx) }}
                    >
                      {label}
                    </Button>
                  )
                })}
              </Stack>
              {resolveErrorKey && !isDebug && (
                <Text as="p" className={runbookStyles.error} data-testid="canvas-resolve-error">{tc(resolveErrorKey)}</Text>
              )}
            </Stack>
          )
        })()}
        {barState.mode === 'interrupted' && (
          <Stack direction="horizontal" gap="condensed" align="center">
            <AlertIcon size={16} fill="var(--fgColor-attention)" />
            <Text size="small" data-testid="run-state-dock-interrupted">{tc('interruptedRun.caption')}</Text>
            <Button
              size="small"
              data-testid="dismiss-interrupted-run"
              onClick={onDismiss}
            >
              {tc('interruptedRun.dismiss')}
            </Button>
          </Stack>
        )}
        {barState.mode === 'finished' && (
          <Stack direction="horizontal" gap="condensed" align="center">
            <StatusStamp variant={FINISHED_VARIANT[barState.status] ?? 'neutral'}>{barState.status}</StatusStamp>
            {barState.error && (
              <>
                <Text size="small" className={runbookStyles.error}>{truncate(barState.error, 120)}</Text>
                <CopyDiagnosisButton
                  error={barState.error}
                  context={{
                    Workflow: runDetail?.workflowLabel,
                    'Workflow ID': runDetail?.workflowID,
                    'Run ID': runDetail?.runID,
                    Started: runDetail?.startedAt,
                    Finished: runDetail?.completedAt,
                  }}
                  testId="canvas-run-copy-diagnosis"
                />
              </>
            )}
            <IconButton
              icon={XIcon}
              aria-label={t('liveRunControls.dismissRunStateAriaLabel')}
              size="small"
              variant="invisible"
              data-testid="dismiss-run-state"
              onClick={onDismiss}
            />
          </Stack>
        )}
      </div>
    </Panel>
  )
}
