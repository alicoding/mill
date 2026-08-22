// Package agentloopsvc is the global tier's goal-directed agent loop
// (goal 0101 slice 1, the TWO-TIER DESIGN CONTRACT's "Architecture"
// section in docs/goals/0101-atlas-ai-companion.md): a bounded,
// visible, cancellable, user-INITIATED multi-step loop against a
// user-configured AIProvider, distinct from companionsvc's single-turn
// Atlas surface tier. Per docs/SPEC.md §1.1's reworded invariant, the
// loop never self-initiates and every write still parks for approval
// mid-loop -- the guardrail always sits between an AI output and a
// real action.
//
// Architecturally the loop is an MCP CLIENT of Mill's own MCP server,
// never a direct caller of the services that back it (ADR-0035): every
// turn lists and calls tools through a real client session
// (MCPConnector, satisfied by mcpsvc.MillMCPService.ConnectInMemoryClient
// in production), exactly the same path an external agent host would
// use over HTTP. This is a new bounded context rather than an addition
// to companionsvc: companionsvc is a stateless single-turn transport
// with no tool plane, while this package owns a genuinely different
// shape of state (a running turn loop, live sessions, tool-call
// dispatch, pause/resume against a parked write) -- composing the two
// into one package would blur two distinct responsibilities, not save
// real duplication.
package agentloopsvc

import (
	"context"
	"fmt"
	"strings"
	"sync"

	"github.com/google/uuid"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// StateEventName/DeltaEventName are registered by main.go
// (application.RegisterEvent) and listened for in the frontend's
// future global-tier panel (goal 0101 slice 2) -- the one place each
// wire name should be spelled, same convention companionsvc.DeltaEventName
// already establishes.
const (
	StateEventName = "agent-loop-state"
	DeltaEventName = "agent-loop-delta"
)

// LoopState is one goal session's current phase -- exactly the state
// set the design contract's Architecture section names, no more, no
// fewer: thinking (the model is generating), calling-tool(name) (a
// tool call is in flight), awaiting-approval(writeID) (a tool call
// parked and the loop is polling its outcome), done, cancelled, failed.
type LoopState string

const (
	StateThinking         LoopState = "thinking"
	StateCallingTool      LoopState = "calling-tool"
	StateAwaitingApproval LoopState = "awaiting-approval"
	StateDone             LoopState = "done"
	StateCancelled        LoopState = "cancelled"
	StateFailed           LoopState = "failed"
)

// AgentLoopEvent is one state transition -- ToolName is set alongside
// calling-tool/awaiting-approval; WriteID is set alongside
// awaiting-approval (the parked write's id, the same id
// check_write_status/Review's queue already use, so a future UI's
// "jump to approval" action has something to point at); Text carries
// the model's final answer on done, or the failure reason on failed.
type AgentLoopEvent struct {
	SessionID string    `json:"sessionId"`
	State     LoopState `json:"state"`
	ToolName  string    `json:"toolName,omitempty"`
	WriteID   string    `json:"writeId,omitempty"`
	Text      string    `json:"text,omitempty"`
}

// AgentLoopDelta is one incremental piece of the model's reply text,
// emitted while a turn is still streaming -- the same shape
// companionsvc.CompanionDelta already establishes for the surface
// tier, split from AgentLoopEvent as its own event (a delta fires far
// more often than a state transition, and a future UI renders them
// into two different places: a live transcript vs. a step timeline).
type AgentLoopDelta struct {
	SessionID string `json:"sessionId"`
	Text      string `json:"text"`
}

// MCPConnector is the one ability this loop needs from Mill's own MCP
// server: a fresh, real client session against it. Satisfied by
// *mcpsvc.MillMCPService in production (main.go wires it directly,
// never through an import of mcpsvc from this package -- the small-
// interface injection pattern backend.md's own reuse boundary
// prescribes, keeping this package testable against a real
// MillMCPService without ever importing it).
type MCPConnector interface {
	ConnectInMemoryClient(ctx context.Context, clientName string) (*mcp.ClientSession, error)
}

// loopSession is the one piece of live state StartGoal keeps per
// running goal: enough to cancel it. The full transcript lives only on
// the run() goroutine's own stack (docs/goals/0101's "transcript state
// lives in memory per app run" -- not even this service holds a second
// copy once a turn is in flight).
type loopSession struct {
	cancel context.CancelFunc
}

// AgentLoopService is goal 0101 slice 1's bound surface -- the global
// tier's StartGoal/CancelGoal, service-layer only (no UI in this
// slice).
type AgentLoopService struct {
	mcp MCPConnector

	mu       sync.Mutex
	sessions map[string]*loopSession
}

// NewAgentLoopService wires the one dependency this service needs.
func NewAgentLoopService(connector MCPConnector) *AgentLoopService {
	return &AgentLoopService{mcp: connector, sessions: map[string]*loopSession{}}
}

// StartGoal begins a new goal-directed loop against aiProviderID/model
// and returns immediately with a sessionID -- the loop itself runs in
// its own goroutine (a parked write can wait on a human for anywhere
// from seconds to the approval's own 24h expiry, so this can never be
// a blocking call the way companionsvc.SendMessage is). Progress
// streams as StateEventName/DeltaEventName events; CancelGoal(sessionID)
// is always available while the loop is running.
func (s *AgentLoopService) StartGoal(aiProviderID, model, goal string) (string, error) {
	if aiProviderID == "" {
		return "", fmt.Errorf("agentloop: no AI provider selected")
	}
	if strings.TrimSpace(goal) == "" {
		return "", fmt.Errorf("agentloop: goal is empty")
	}

	sessionID := uuid.NewString()
	ctx, cancel := context.WithCancel(context.Background())

	s.mu.Lock()
	s.sessions[sessionID] = &loopSession{cancel: cancel}
	s.mu.Unlock()

	go s.run(ctx, sessionID, aiProviderID, model, goal)
	return sessionID, nil
}

// CancelGoal cancels sessionID's loop -- always one action, per the
// design contract's own "cancellation is always one action" clause.
// Cancelling an already-finished (or unknown) session is an error, not
// a silent no-op: a caller asking to cancel something that no longer
// exists gets to know that, rather than assuming it worked.
func (s *AgentLoopService) CancelGoal(sessionID string) error {
	s.mu.Lock()
	sess, ok := s.sessions[sessionID]
	s.mu.Unlock()
	if !ok {
		return fmt.Errorf("agentloop: no running session %q", sessionID)
	}
	sess.cancel()
	return nil
}

// endSession drops sessionID's bookkeeping once its loop reaches a
// terminal state (done/cancelled/failed) -- called once, from run's own
// defer, so CancelGoal on a finished session correctly reports "no
// running session" instead of cancelling an already-cancelled context.
func (s *AgentLoopService) endSession(sessionID string) {
	s.mu.Lock()
	delete(s.sessions, sessionID)
	s.mu.Unlock()
}
