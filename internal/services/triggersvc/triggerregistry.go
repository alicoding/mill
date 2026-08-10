package triggersvc

// triggerStarter registers the live listener a trigger node type needs,
// given the owning TriggerService (for its own state -- s.hkRaw, s.fire
// -- and mutation helpers) and the trigger node's config. Returns nil,
// nil for a trigger type with nothing to start yet (e.g. no hotkey
// assigned) -- not an error, same as the old switch's per-case early
// returns.
type triggerStarter func(s *TriggerService, workflowID string, config map[string]string) (*activeListener, error)

var triggerRegistry = map[string]triggerStarter{}

// RegisterTrigger is called once per trigger type, from that type's own
// init() -- the same database/sql-driver-style pattern as
// composition.RegisterNodeType (docs/adr/0006-extension-point-
// registration.md), the second of the two registries that ADR needs: a
// trigger starter needs real *TriggerService state (RegisterNodeType's
// ExecFunc signature has no room for that, and internal/domain/
// composition can't import this service package regardless --
// domain-purity rule, CLAUDE.md). Panics on a duplicate ID, same
// fail-fast shape as
// RegisterNodeType -- see that function's own doc comment
// (internal/domain/composition/registry.go) for the documented
// divergence from RegisterAuthStrategy's silent-overwrite semantics.
func RegisterTrigger(nodeTypeID string, start triggerStarter) {
	if _, exists := triggerRegistry[nodeTypeID]; exists {
		panic("triggersvc: trigger type " + nodeTypeID + " registered twice")
	}
	triggerRegistry[nodeTypeID] = start
}
