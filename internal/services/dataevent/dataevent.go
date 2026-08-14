// Package dataevent is the ONE shared emit point for Mill's live-sync
// event (docs/adr/0025, goal 0017): every direct-mutation service --
// mcpsvc (external MCP authoring), compositionsvc, configuresvc,
// guardrailsvc -- calls Emit after a successful write so every open
// Mill surface refreshes what just changed, instead of only the
// MCP-authored path doing so (goal 0017's audit root cause: before
// this package existed, mcpsvc alone defined and emitted this event,
// so a plain UI create/edit never reached another open tab/picker).
// A tiny package of its own, not folded into mcpsvc or compositionsvc,
// because mcpsvc already imports compositionsvc/configuresvc
// (millmcpservice.go) -- those two importing back to reuse mcpsvc's
// old DataChanged type would be circular; this sits below all four so
// each can import it (.claude/rules/backend.md's shared-cross-service-
// helper convention, same shape as internal/services/seeding).
package dataevent

import "github.com/wailsapp/wails/v3/pkg/application"

// Changed is the live-sync event payload: which kind of entity changed
// (e.g. "workflow", "request", "list", "mcpserver", "decision",
// "execenv", "guardrail-rule", "run", "hotkey", "keybinding") and its
// ID -- "hotkey" carries the workflow ID its combo binds to,
// "keybinding" carries the command ID its combo overrides.
type Changed struct {
	Entity string `json:"entity"`
	ID     string `json:"id"`
}

// EventName is registered by main.go (application.RegisterEvent) and
// listened for in frontend/src/app/App.tsx via Events.On. Exported as
// the single source of the wire name -- no other file should spell it
// as a string literal.
const EventName = "mill-data-changed"

// Emit fires EventName with the given entity/id, a no-op when no Wails
// application is running (e.g. a plain `go test` of a service package
// with no application.New ever called) -- application.Get() returns
// nil in that case, same defensive check mcpsvc's original emit
// helper already had. TestHook (below) is invoked unconditionally
// alongside it, so a mutating method's test can prove "this emits"
// without spinning up a real Wails application.
func Emit(entity, id string) {
	if app := application.Get(); app != nil {
		app.Event.Emit(EventName, Changed{Entity: entity, ID: id})
	}
	if TestHook != nil {
		TestHook(entity, id)
	}
}

// TestHook, when non-nil, is invoked by every Emit call with the same
// (entity, id) -- the ONE seam every mutating service's test uses
// (compositionsvc/configuresvc/guardrailsvc/mcpsvc) to assert "this
// method emits mill-data-changed" (goal 0017's DoD): application.Get()
// always returns nil under `go test` (no real Wails application is
// ever constructed there), so the production app.Event.Emit path is
// silently unobservable -- this hook is the alternative, same shape as
// servicetest.FakeStore.SetErr being the seam for persist-failure
// tests. Package-level and shared across a test binary, so a test that
// sets it MUST restore it to nil via t.Cleanup before returning,
// otherwise a later, unrelated test in the same package would trip it.
var TestHook func(entity, id string)
