package triggersvc

import (
	"encoding/json"
	"strconv"

	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/executionsvc"
)

// DispatchLifecycleEvent is dataevent's lifecycle sink (docs/goals/0392
// S2), wired from NewTriggerService itself (dataevent.SetLifecycleSink)
// rather than from main.go: unlike ExecutionService.SetSystemEventSink,
// triggersvc already imports dataevent (triggerhotkeyassignment.go), so
// there is no reverse-dependency problem to route around a setter for.
//
// Reuses trigger-system-event's OWN registry (s.sysEvents, populated by
// triggersystemevent.go's starter for WHATEVER string a workflow's
// "event" config holds) rather than a second map: the entity/object
// event strings are just a wider vocabulary for the same "event" field,
// so no new NodeType or starter is needed for them to arm.
//
// A lifecycle event carries no source workflow, so every armed binding
// fires regardless of its own Scope (workflowScope only means something
// for the run/decision system events, whose own ExtractTrigger-based
// loop guard also doesn't apply here: nothing about creating, deleting,
// or (de)referencing an entity or object can recurse into re-firing
// itself).
func (s *TriggerService) DispatchLifecycleEvent(ev dataevent.LifecycleEvent) {
	s.mu.Lock()
	targets := append([]systemEventBinding(nil), s.sysEvents[ev.Event]...)
	s.mu.Unlock()
	if len(targets) == 0 {
		return
	}
	payload, err := json.Marshal(ev)
	if err != nil {
		s.logger.Error("lifecycle-event: encode payload", "event", ev.Event, "error", err)
		return
	}
	values := lifecycleAttributeValues(ev)
	for _, b := range targets {
		go s.fireLifecycleEvent(b.WorkflowID, string(payload), values)
	}
}

// fireLifecycleEvent starts workflowID as a lifecycle-event fire,
// passing values through as run Attribute overrides -- same shape
// fireWebhookEvent/fireAtlasCard already use for their own harvested
// fields.
func (s *TriggerService) fireLifecycleEvent(workflowID, payload string, values map[string]string) {
	summary, err := s.exec.RunWorkflowWithPayload(workflowID, executionsvc.RunKindTriggered, values, payload)
	s.reportFireOutcome(workflowID, "", summary, err)
}

// lifecycleAttributeValues harvests ev's own top-level scalars into a
// workflow's declared Attributes by name -- the same permissive shape
// trigger-atlas-card's own four-key values map already uses (goal 0368):
// whichever of these a workflow actually declares gets filled, the rest
// sit unused. "by" is itself an object, never a scalar, so its two
// possible shapes are flattened into byBoardId/byObjectId/byWorkflowId
// rather than harvested as one field.
func lifecycleAttributeValues(ev dataevent.LifecycleEvent) map[string]string {
	values := map[string]string{
		"event": ev.Event, "entityKind": ev.EntityKind, "entityId": ev.EntityID,
		"boardId": ev.BoardID, "objectId": ev.ObjectID, "kind": ev.Kind, "entityRef": ev.EntityRef,
	}
	if ev.By != nil {
		values["byBoardId"] = ev.By.BoardID
		values["byObjectId"] = ev.By.ObjectID
		values["byWorkflowId"] = ev.By.WorkflowID
	}
	if ev.Remaining != nil {
		values["remaining"] = strconv.Itoa(*ev.Remaining)
	}
	return values
}
