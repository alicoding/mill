package dataevent

import "github.com/alicoding/mill/internal/adapters/windowing"

// LifecycleEventName is registered by main.go (application.RegisterEvent)
// and listened for in frontend/src/app/pluginActivationBridge.ts's
// subscribe() and frontend/src/plugins/hostApi.ts's on(), for the
// 'entity.*'/'object.*' topics (docs/goals/0392 Decision 4) -- additive
// to Changed above, which stays the coarse "something changed, refetch"
// signal. This is the platform's own lifecycle vocabulary: which of six
// transitions just happened, and to what.
const LifecycleEventName = "mill-lifecycle-event"

// LifecycleBy names what added or removed one reference to an entity:
// a board object (BoardID+ObjectID), a workflow (WorkflowID), or a
// plugin's own declared setting (PluginID+SettingKey, docs/goals/0400)
// -- the three sources reference.Refs distinguishes. Exactly one
// group populated per event; a pointer field on LifecycleEvent so an
// event with no By (entity.created/entity.deleted) carries neither.
type LifecycleBy struct {
	BoardID    string `json:"boardId,omitempty"`
	ObjectID   string `json:"objectId,omitempty"`
	WorkflowID string `json:"workflowId,omitempty"`
	PluginID   string `json:"pluginId,omitempty"`
	SettingKey string `json:"settingKey,omitempty"`
}

// LifecycleEvent is the one entity/object lifecycle event family (docs/
// goals/0392 Decision 4). Event discriminates which of the six
// transitions fired; every other field is populated only by the
// Emit* function that produces that event (see each one's own doc
// comment below) -- ids and kinds only, never the entity's own
// content, so a subscriber queries what it needs instead of trusting a
// payload that could go stale.
type LifecycleEvent struct {
	Event string `json:"event"`
	// EntityKind/EntityID: every entity.* event.
	EntityKind string `json:"entityKind,omitempty"`
	EntityID   string `json:"entityId,omitempty"`
	// By: entity.referenced/entity.dereferenced only -- which board
	// object added or removed the reference.
	By *LifecycleBy `json:"by,omitempty"`
	// Remaining: entity.dereferenced only -- how many live references
	// (board objects plus workflow nodes) survive this one's removal;
	// 0 means the entity is now unused anywhere.
	Remaining *int `json:"remaining,omitempty"`
	// BoardID/ObjectID: object.created/object.deleted only.
	BoardID  string `json:"boardId,omitempty"`
	ObjectID string `json:"objectId,omitempty"`
	// Kind: object.created only -- the board object's own kind.
	Kind string `json:"kind,omitempty"`
	// EntityRef: object.created only -- the Configure entity kind this
	// object's kind declares a reference to ("list" for table), empty
	// for a kind with none declared.
	EntityRef string `json:"entityRef,omitempty"`
}

// lifecycleSink, when non-nil, is TriggerService.DispatchLifecycleEvent
// -- triggersvc already imports this package (triggerhotkeyassignment.go),
// so it installs itself directly from its own constructor rather than
// needing a main.go setter, unlike executionsvc.SetSystemEventSink
// (which triggersvc CANNOT call itself, since executionsvc is built
// after it). Nil (every direct `go test` of a door package with no
// TriggerService constructed) is simply a no-op, the same posture
// Emit's own windowing.Emit already takes for a headless test.
var lifecycleSink func(LifecycleEvent)

// SetLifecycleSink installs the dispatch seam. Called once from
// triggersvc.NewTriggerService.
func SetLifecycleSink(fn func(LifecycleEvent)) {
	lifecycleSink = fn
}

// LifecycleTestHook, when non-nil, is invoked by every emitLifecycle
// call -- the seam a door's own test uses to assert "this method fires
// entity.X"/"object.X", the same shape TestHook above gives Changed.
// Package-level and shared across a test binary: a test that sets it
// MUST restore it to nil via t.Cleanup before returning.
var LifecycleTestHook func(LifecycleEvent)

func emitLifecycle(ev LifecycleEvent) {
	windowing.Emit(LifecycleEventName, ev)
	if lifecycleSink != nil {
		lifecycleSink(ev)
	}
	if LifecycleTestHook != nil {
		LifecycleTestHook(ev)
	}
}

// EmitEntityCreated fires when a Configure entity is minted -- called
// from that entity kind's own creation door (configuresvc's
// createListWithID today; a future kind wires it on its own next
// touch, the same "ride the shared shape" posture docs/goals/0392 S1
// already took for usage/orphans).
func EmitEntityCreated(entityKind, entityID string) {
	emitLifecycle(LifecycleEvent{Event: "entity.created", EntityKind: entityKind, EntityID: entityID})
}

// EmitEntityReferenced fires when a board object starts carrying a
// reference to a Configure entity -- called from CreateBoardObject for
// any kind declaring an entityRef.
func EmitEntityReferenced(entityKind, entityID string, by LifecycleBy) {
	emitLifecycle(LifecycleEvent{Event: "entity.referenced", EntityKind: entityKind, EntityID: entityID, By: &by})
}

// EmitEntityDereferenced fires when a board object carrying a
// reference to a Configure entity is deleted -- called from
// DeleteBoardObject. remaining is the reference index's own live count
// (board objects plus workflow nodes) immediately after this removal.
func EmitEntityDereferenced(entityKind, entityID string, by LifecycleBy, remaining int) {
	emitLifecycle(LifecycleEvent{Event: "entity.dereferenced", EntityKind: entityKind, EntityID: entityID, By: &by, Remaining: &remaining})
}

// EmitEntityDeleted fires when a Configure entity itself is deleted --
// called from that entity kind's own delete door (configuresvc's
// DeleteList today).
func EmitEntityDeleted(entityKind, entityID string) {
	emitLifecycle(LifecycleEvent{Event: "entity.deleted", EntityKind: entityKind, EntityID: entityID})
}

// EmitObjectCreated fires for every new board object, regardless of
// kind -- called from CreateBoardObject. entityRef is "" for a kind
// with no declared entityRef (image, ink, shape, ...).
func EmitObjectCreated(boardID, objectID, kind, entityRef string) {
	emitLifecycle(LifecycleEvent{Event: "object.created", BoardID: boardID, ObjectID: objectID, Kind: kind, EntityRef: entityRef})
}

// EmitObjectDeleted fires for every board object delete, regardless of
// kind -- called from DeleteBoardObject.
func EmitObjectDeleted(boardID, objectID string) {
	emitLifecycle(LifecycleEvent{Event: "object.deleted", BoardID: boardID, ObjectID: objectID})
}
