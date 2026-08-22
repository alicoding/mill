package agentloopsvc

import "github.com/alicoding/mill/internal/adapters/windowing"

// stateTestHook/deltaTestHook let a test observe emitted events without
// a live Wails application (application.Get() returns nil under `go
// test`) -- same seam shape as companionsvc's deltaTestHook. Package-
// level and shared across a test binary: a test that sets one must
// restore it to nil via t.Cleanup before returning.
var (
	stateTestHook func(AgentLoopEvent)
	deltaTestHook func(AgentLoopDelta)
)

// SetStateTestHook installs stateTestHook -- test-only.
func SetStateTestHook(fn func(AgentLoopEvent)) { stateTestHook = fn }

// SetDeltaTestHook installs deltaTestHook -- test-only.
func SetDeltaTestHook(fn func(AgentLoopDelta)) { deltaTestHook = fn }

// emitState pushes one AgentLoopEvent -- the exact type main.go
// registers via application.RegisterEvent[AgentLoopEvent](StateEventName).
// Emitting any other type (or a zero-value stand-in) under this name
// would silently drop at the registered-type check (RegisterEvent's own
// doc comment: "Data types are matched exactly and no conversion is
// performed") -- the gotcha docs/goals/0026's own emitMCPWriteApprovalChanged
// comment records finding live once already. agentloopservice_events_test.go
// pins this exact type against every call site below so a future edit
// can't drift the two apart unnoticed.
func emitState(sessionID string, state LoopState, toolName, writeID, text string) {
	evt := AgentLoopEvent{SessionID: sessionID, State: state, ToolName: toolName, WriteID: writeID, Text: text}
	windowing.Emit(StateEventName, evt)
	if stateTestHook != nil {
		stateTestHook(evt)
	}
}

// emitDelta pushes one AgentLoopDelta -- see emitState's doc comment
// for the exact-type contract this mirrors.
func emitDelta(sessionID, text string) {
	d := AgentLoopDelta{SessionID: sessionID, Text: text}
	windowing.Emit(DeltaEventName, d)
	if deltaTestHook != nil {
		deltaTestHook(d)
	}
}
