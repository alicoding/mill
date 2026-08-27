import { useEffect, useRef, useState } from 'react'
import { Events } from '@wailsio/runtime'
import { CodeLoopService, ExecutionService } from './bindings'
import type { CommandBlockPreview, RunDetail } from './bindings'
import type { CodingLoopStepProgressEvent } from './codingLoopTypes'
import { CODING_LOOP_POLL_INTERVAL_MS, CODING_LOOP_PROGRESS_EVENT } from './codingLoopConstants'
import { writeClipboardText } from './clipboardWrite'

// The coding loop's own state machine (docs/goals/0240 S1): Confirm ->
// Running -> Result, driven entirely through ExecutionService's
// existing RunWorkflowWithPayload/ResolveApproval/GetRun/CancelRun --
// no bespoke exec RPC (the goal's own divergence statement). Reused by
// both the Quick Panel door (app/useQuickPanelCodingLoopDoor.ts) and the
// main window's CodingLoopDialog, so this file owns no window-specific
// concerns (no Dialog/panel chrome, no i18n strings) -- CodingLoopSurface
// and its per-state children own presentation.

export type CodingLoopPhase = 'confirm' | 'running' | 'result'

function isInFlightStatus(status: string | undefined): boolean {
  return status === 'PENDING' || status === 'RUNNING' || status === 'ENQUEUED'
}

export interface UseCodingLoopRunResult {
  phase: CodingLoopPhase
  preview: CommandBlockPreview | null
  previewError: string | null
  detail: RunDetail | null
  stepProgress: Record<number, CodingLoopStepProgressEvent>
  startError: string | null
  copyState: 'idle' | 'copied' | 'error'
  lastProgressAt: number | null
  // typedSecrets/setTypedSecret (goal 0240 S2): the values the user
  // typed at Confirm for a "you'll type it"-sourced secret requirement,
  // keyed by var name -- lives here (not inside CodingLoopConfirmState)
  // so run() can read it directly without a round trip through state.
  typedSecrets: Record<string, string>
  setTypedSecret: (varName: string, value: string) => void
  run: () => void
  cancel: () => void
  copyResult: () => void
}

// useCodingLoopRun owns everything about ONE capture flow's lifecycle,
// keyed to the clipboard text it was opened with. clipboardText is read
// by the CALLER (CompositionService.ReadHostClipboardText -- never
// navigator.clipboard, .claude/rules/frontend.md) since the two mount
// points (the panel's auxiliary WKWebView, the main window) read it
// through different doors but the same Go RPC.
export function useCodingLoopRun(clipboardText: string): UseCodingLoopRunResult {
  const [phase, setPhase] = useState<CodingLoopPhase>('confirm')
  const [preview, setPreview] = useState<CommandBlockPreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [runID, setRunID] = useState<string | null>(null)
  const [detail, setDetail] = useState<RunDetail | null>(null)
  const [stepProgress, setStepProgress] = useState<Record<number, CodingLoopStepProgressEvent>>({})
  const [startError, setStartError] = useState<string | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  const [typedSecrets, setTypedSecrets] = useState<Record<string, string>>({})
  const setTypedSecret = (varName: string, value: string) => {
    setTypedSecrets((prev) => ({ ...prev, [varName]: value }))
  }
  // lastProgressAt is the Running screen's own "stuck for Ns" clock --
  // the timestamp of the most recent progress event of ANY kind (the
  // initial "running" emit included), so a command that produces
  // genuinely no output while it runs still starts its stuck-timer at
  // the moment it started, not at "never." Set once phase becomes
  // 'running'.
  const [lastProgressAt, setLastProgressAt] = useState<number | null>(null)

  // Guards the preview fetch + the mount-time re-adopt below against a
  // response landing after the component (or the door) already
  // unmounted -- same cancelled-flag shape liveRunState.ts's own mount
  // effect uses.
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])

  // On mount: preview the captured block AND re-adopt any already
  // in-flight run for this workflow (docs/goals/0240's own "closing the
  // surface parks it visibly" requirement -- reopening the door picks
  // the SAME live run back up instead of losing it, mirroring
  // liveRunState.ts's own mount-time-adopt GAP-A pattern).
  useEffect(() => {
    CodeLoopService.PreviewCommandBlock(clipboardText)
      .then((p) => {
        if (!mounted.current) return
        setPreview(p)
        ExecutionService.ListRunsForWorkflow(p.workflowID)
          .then((runs) => {
            if (!mounted.current) return
            const newest = (runs ?? [])[0]
            if (newest && (isInFlightStatus(newest.status) || newest.pending != null)) {
              setRunID(newest.runID)
              setPhase('running')
              setLastProgressAt(Date.now())
            }
          })
          .catch(() => {})
      })
      .catch((err) => {
        if (mounted.current) setPreviewError(String(err))
      })
    // clipboardText is captured once at open time -- a door instance is
    // created fresh per capture, never reused across two different
    // clipboard reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Live per-sub-command output while running.
  useEffect(() => {
    if (phase !== 'running' || !runID) return
    return Events.On(CODING_LOOP_PROGRESS_EVENT, (evt) => {
      const data = evt.data as CodingLoopStepProgressEvent
      if (data.runID !== runID) return
      setStepProgress((prev) => ({ ...prev, [data.stepIndex]: data }))
      setLastProgressAt(Date.now())
    })
  }, [phase, runID])

  // Checkpointed step/run status, polled as the backstop that notices a
  // step transition to done/failed/skipped and the run's own terminal
  // status -- the progress event above only ever covers a RUNNING
  // step's own output tail. ALSO where the auto-approval actually
  // happens: RunWorkflowWithPayload's own immediate response frequently
  // still shows no pending approval at all (the guardrail gate parks
  // asynchronously, a moment after the durable run starts -- confirmed
  // live, not assumed), so resolving off that initial response raced
  // and silently never approved anything. Polling here is what
  // genuinely observes the park, the same "poll until Pending appears"
  // shape the Go seed test's own waitFor uses.
  const autoApprovedKey = useRef<string | null>(null)
  useEffect(() => {
    if (phase !== 'running' || !runID) return
    const tick = () => {
      ExecutionService.GetRun(runID)
        .then((d) => {
          if (!mounted.current) return
          setDetail(d)
          if (d.pending) {
            const key = `${runID}:${d.pending.nodeID}`
            if (autoApprovedKey.current !== key) {
              autoApprovedKey.current = key
              // The Confirm click IS the approval gesture (docs/goals/0240
              // S1: "everything confirms" happens ONCE, up front, not as
              // a second popup per step) -- this resolves the SAME real
              // guardrail ask through the real ResolveApproval RPC,
              // never a bypass of it.
              ExecutionService.ResolveApproval(runID, d.pending.nodeID, true, {}, false).catch((err) => {
                if (mounted.current) setStartError(String(err))
              })
            }
            return
          }
          if (!isInFlightStatus(d.status)) setPhase('result')
        })
        .catch(() => {})
    }
    tick()
    const timer = setInterval(tick, CODING_LOOP_POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [phase, runID])

  const run = () => {
    if (!preview) return
    setStartError(null)
    // CodeLoopService.RunCommandBlock (goal 0240 S2, replacing S1's own
    // direct RunWorkflowWithPayload call): stashes any typed-at-Confirm
    // secret values and starts the SAME real run (RunKindTest, matching
    // the seeded "Example: Run copied code" precedent -- a triggered run
    // requires a PUBLISHED snapshot, a publish-state concern this
    // hotkey/palette-invoked capture has no reason to depend on) in one
    // atomic backend call, so the stash is guaranteed to exist before
    // process-shell-command's own secret resolution ever needs it.
    CodeLoopService.RunCommandBlock(preview.workflowID, clipboardText, typedSecrets)
      .then((summary) => {
        if (!mounted.current) return
        setRunID(summary.runID)
        setPhase('running')
        setLastProgressAt(Date.now())
        // Auto-approval happens in the polling effect below, not here --
        // see its own comment for why the immediate response is the
        // wrong place to look for the park.
      })
      .catch((err) => {
        if (mounted.current) setStartError(String(err))
      })
  }

  const cancel = () => {
    if (runID) ExecutionService.CancelRun(runID).catch(() => {})
  }

  const copyResult = () => {
    const output = detail?.output ?? ''
    writeClipboardText(output)
      .then(() => setCopyState('copied'))
      .catch(() => setCopyState('error'))
  }

  return {
    phase, preview, previewError, detail, stepProgress, startError, copyState, lastProgressAt,
    typedSecrets, setTypedSecret, run, cancel, copyResult,
  }
}
