// CodingLoopStepProgressEvent is the codingloop-step-progress Wails
// event payload -- hand-declared because it travels over Events.On
// (windowing.Emit on the Go side), not a service method return value,
// so `wails3 generate bindings` never sees it (same reason
// GuardrailPendingChanged's own shape is imported as a bound service
// TYPE while the event itself is still subscribed to by string name).
// Field names/casing mirror executionservice_codingloop.go's
// CodingLoopStepProgressEvent and composition.ShellStepProgress JSON
// tags exactly.
export interface CodingLoopStepProgressEvent {
  runID: string
  nodeID: string
  stepIndex: number
  totalSteps: number
  command: string
  status: 'running' | 'done' | 'failed' | 'skipped'
  outputTail?: string
  exitCode?: number
}
