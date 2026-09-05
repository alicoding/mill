import { useCallback, useState } from 'react'
import { ExecutionService } from './bindings'
import { userErrorFrom } from './userError'

// One home for "the human answered a parked run" (goal 0329). Three
// surfaces render controls on the same park -- the canvas bar, the run
// detail's approval banner in the Runs panel, and the Review queue row
// -- and each used to own its own ResolveApproval call and its own idea
// of what a failure meant (the canvas swallowed it into console.error,
// the other two rendered the raw Go error text). The reported symptom
// was a park that survived a relaunch with three sets of dead buttons.
// This module owns the call, the refusal vocabulary, and which run a
// refusal belongs to; each surface owns only where it renders the copy.

// The stable codes ExecutionService.ResolveApproval returns when
// nothing in the backend is listening for a decision
// (executionservice_guardrail.go's resolveUnlistened), mapped to the
// i18n key the answering surface renders. Pure and exported so the
// mapping is testable without a live run.
const KEY_FOR_CODE: Record<string, string> = {
  'run-not-waiting': 'errors.run-not-waiting',
  'run-recovering': 'errors.run-recovering',
}

export function resolveErrorKey(err: unknown): string {
  return KEY_FOR_CODE[userErrorFrom(err).code] ?? 'resolveError.generic'
}

export interface ResolveApprovalInput {
  runID: string
  nodeID: string
  approve: boolean
  // The reviewer's typed input for a human-review checkpoint or a
  // breakpoint edit-and-resume; discarded on a deny/stop.
  values?: Record<string, string>
  // Only meaningful for a stepped run's park: false is "Step" (the next
  // node parks too), true is "Resume"/"Continue".
  continueRun?: boolean
}

export interface ApprovalResolution {
  // The i18n key (in the `common` namespace) of the last refusal aimed
  // at runID, empty when that run's last decision landed. Scoped by run
  // so a queue of several parked runs shows the answer against the row
  // that was actually clicked.
  errorKeyFor: (runID: string) => string
  clearError: () => void
  // Resolves to true when the decision was delivered, false when it was
  // refused -- the caller decides what to refetch either way.
  resolveApproval: (input: ResolveApprovalInput) => Promise<boolean>
}

// The bare call, hook-free, so a registry command (shared/rowCommands.ts's
// run.continue/run.step) answers a park through this same seam rather than
// reaching for ExecutionService itself. A rejection propagates untouched:
// runCommand turns it into the one error notice, whose wording comes from
// the same `run-not-waiting`/`run-recovering` codes KEY_FOR_CODE names
// above, resolved by shared/userError.ts.
export function resolveApprovalCall({ runID, nodeID, approve, values, continueRun }: ResolveApprovalInput): Promise<void> {
  return ExecutionService.ResolveApproval(runID, nodeID, approve, approve ? (values ?? {}) : {}, continueRun ?? false)
}

export function useApprovalResolution(): ApprovalResolution {
  const [refusal, setRefusal] = useState<{ runID: string; key: string } | null>(null)
  const clearError = useCallback(() => setRefusal(null), [])
  const resolveApproval = useCallback((input: ResolveApprovalInput) => {
    const { runID } = input
    setRefusal(null)
    return resolveApprovalCall(input)
      .then(() => true)
      .catch((err) => {
        // A refused decision is user-facing state, never console noise:
        // the run either is not waiting any more or is still being
        // recovered, and both change what the surface should say.
        setRefusal({ runID, key: resolveErrorKey(err) })
        return false
      })
  }, [])
  const errorKeyFor = useCallback((runID: string) => (refusal?.runID === runID ? refusal.key : ''), [refusal])
  return { errorKeyFor, clearError, resolveApproval }
}
