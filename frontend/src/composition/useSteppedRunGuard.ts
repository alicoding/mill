import { useState } from 'react'
import { usePendingReviewStore } from '../review/pendingReviewStore'
import { runCommand } from '../shared/commands'
import type { RunSummary } from '../shared/bindings'

// A second stepped run of a workflow that already has one paused would
// leave two runs of the same graph parked at once, and the canvas can
// only ever show one of them (goal 0328). So the start is held and the
// question asked first, with the same three answers leaving the editor
// asks: stop the paused one, keep it and start anyway, or cancel.
export interface SteppedRunGuard {
  // The paused run the prompt is about, null when nothing is being asked.
  pausedRun: RunSummary | null
  // Wraps the canvas's own startRun: a non-stepped run is never held.
  guardedStartRun: (values: Record<string, string>, stepped?: boolean, payload?: string) => void
  // Answers the prompt: stop the paused run first, or leave it paused.
  // Either way the held start proceeds.
  answer: (stop: boolean) => void
  cancel: () => void
}

export function useSteppedRunGuard(
  workflowId: string | undefined,
  startRun: (values: Record<string, string>, stepped?: boolean, payload?: string) => void,
): SteppedRunGuard {
  const pausedDebug = usePendingReviewStore((s) => s.pausedDebug)
  const [held, setHeld] = useState<{ values: Record<string, string>; payload?: string } | null>(null)
  const paused = workflowId ? pausedDebug.find((r) => r.workflowID === workflowId) ?? null : null

  return {
    pausedRun: held ? paused : null,
    guardedStartRun: (values, stepped, payload) => {
      if (stepped && paused) {
        setHeld({ values, payload })
        return
      }
      startRun(values, stepped, payload)
    },
    answer: (stop) => {
      const pending = held
      setHeld(null)
      if (!pending) return
      const stopped = stop && paused
        ? runCommand('run.stop', { kind: 'run', runId: paused.runID, workflowId: paused.workflowID, nodeId: paused.pending?.nodeID })
        : Promise.resolve(true)
      // The new run starts only once the old one has actually been told
      // to stop -- starting first races the engine into two live parks.
      void stopped.then(() => startRun(pending.values, true, pending.payload))
    },
    cancel: () => setHeld(null),
  }
}
