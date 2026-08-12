package triggersvc

import (
	"encoding/json"

	"github.com/alicoding/mill/internal/services/executionsvc"
)

// systemEventBinding is one workflow's arming for one system-event kind
// (docs/adr/0035) -- WorkflowID is who fires, Scope is which source
// workflow's event it fires for ("" means every workflow's matching
// event, matching trigger-system-event's own "all" default).
type systemEventBinding struct {
	WorkflowID string
	Scope      string
}

// Schema (composition.NodeType{ID: "trigger-system-event", ...}) registers
// from internal/domain/composition/triggers.go, not here -- see that
// file's doc comment. This dispatch half needs real *TriggerService
// state (s.sysEvents), so it can't live in the domain package.
func init() {
	RegisterTrigger("trigger-system-event", func(s *TriggerService, workflowID string, config map[string]string) (*activeListener, error) {
		event := config["event"]
		if event == "" {
			return nil, nil
		}
		// Sync (the only caller of start, hence of this closure) already
		// holds s.mu for its entire body -- no separate lock here, same
		// as every other trigger type's own starter.
		s.sysEvents[event] = append(s.sysEvents[event], systemEventBinding{WorkflowID: workflowID, Scope: config["workflowScope"]})
		return &activeListener{sysEventStop: func() {
			bindings := s.sysEvents[event]
			for i, b := range bindings {
				if b.WorkflowID == workflowID {
					s.sysEvents[event] = append(bindings[:i], bindings[i+1:]...)
					break
				}
			}
		}}, nil
	})
}

// DispatchSystemEvent is the dispatch half of docs/adr/0035's injected
// seam: ExecutionService.SetSystemEventSink is wired to this method from
// main.go once both services exist (executionsvc never imports this
// package -- the dependency runs the other way, same as every other
// injected-function seam in this codebase, .claude/rules/backend.md).
// Fires every workflow currently armed for ev.Event whose configured
// scope matches -- empty/"all" arms for every workflow's event, a
// specific workflow ID arms only for that one source. Each fire runs
// async (s.fire blocks until the started run completes, and this method
// is always called synchronously from inside or right after the run
// that produced ev -- firing inline here would nest a whole second run
// inside the first one's own call stack).
//
//wails:ignore
func (s *TriggerService) DispatchSystemEvent(ev executionsvc.SystemEvent) {
	s.mu.Lock()
	var targets []string
	for _, b := range s.sysEvents[string(ev.Event)] {
		if b.Scope == "" || b.Scope == "all" || b.Scope == ev.WorkflowID {
			targets = append(targets, b.WorkflowID)
		}
	}
	s.mu.Unlock()

	if len(targets) == 0 {
		return
	}
	payload, err := json.Marshal(ev)
	if err != nil {
		s.logger.Error("system-event: encode payload", "event", ev.Event, "error", err)
		return
	}
	for _, wfID := range targets {
		go s.fire(wfID, "", string(payload))
	}
}
