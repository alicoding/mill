import { ExecutionService } from '../shared/bindings'
import { RunKind, type RunSummary } from '../../bindings/github.com/alicoding/mill/internal/services/executionsvc/models'

// Which run entry point a Run uses -- split out of CompositionView.tsx
// at the 500-line convention, along the seam the choice actually is:
// three bound methods, each meaning something different about what the
// caller decided, not one method with optional arguments.
//
// 'environment' is only correct when the caller genuinely offered the
// choice: that entry point takes an empty environment as "none" and
// obeys it, where every other one falls back to the workflow's own
// default.
export type RunEntryPoint = 'environment' | 'payload' | 'plain'

export function runEntryPointFor(payload: string | undefined, environmentID: string | undefined): RunEntryPoint {
  if (environmentID !== undefined) return 'environment'
  if (payload) return 'payload'
  return 'plain'
}

export function startWorkflowRun(
  id: string,
  values: Record<string, string> | null,
  payload?: string,
  environmentID?: string,
): Promise<RunSummary> {
  switch (runEntryPointFor(payload, environmentID)) {
    case 'environment':
      return ExecutionService.RunWorkflowInEnvironment(id, RunKind.RunKindTest, values, payload ?? '', environmentID ?? '')
    case 'payload':
      return ExecutionService.RunWorkflowWithPayload(id, RunKind.RunKindTest, values, payload ?? '')
    default:
      return ExecutionService.RunWorkflow(id, RunKind.RunKindTest, values)
  }
}
