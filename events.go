// events.go: main.go's own application.RegisterEvent[T] calls, split
// out along the same family seam auxwindows.go already established
// (main.go crossing CLAUDE.md's 500-line convention) -- `package main`
// since RegisterEvent needs the concrete Go type at its own call site,
// and every payload type here already belongs to a service package
// main.go itself imports to construct that service.
package main

import (
	"github.com/alicoding/mill/internal/services/agentloopsvc"
	"github.com/alicoding/mill/internal/services/atlassvc"
	"github.com/alicoding/mill/internal/services/companionsvc"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/executionsvc"
	"github.com/alicoding/mill/internal/services/mcpsvc"
	"github.com/alicoding/mill/internal/services/secretsvc"
	"github.com/alicoding/mill/internal/services/triggersvc"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func init() {
	// Each RegisterEvent[T] gives the binding generator a typed JS/TS API.
	application.RegisterEvent[string]("time")
	application.RegisterEvent[triggersvc.HotkeyActivity]("hotkey-activity")
	application.RegisterEvent[mcpsvc.MCPWriteRequest]("mcp-write-approval")
	application.RegisterEvent[mcpsvc.MCPWriteActivity]("mcp-write-activity")
	application.RegisterEvent[dataevent.Changed](dataevent.EventName)
	application.RegisterEvent[atlassvc.MirrorChanged](atlassvc.MirrorChangedEvent)
	application.RegisterEvent[secretsvc.SourcesChanged](secretsvc.SourcesChangedEvent)
	application.RegisterEvent[executionsvc.GuardrailPendingChanged]("guardrail-pending-changed")
	application.RegisterEvent[companionsvc.CompanionDelta](companionsvc.DeltaEventName)
	application.RegisterEvent[agentloopsvc.AgentLoopEvent](agentloopsvc.StateEventName)
	application.RegisterEvent[agentloopsvc.AgentLoopDelta](agentloopsvc.DeltaEventName)
	// docs/adr/0033: OpenMainWindow emits this so App.tsx can switch views
	// once the main window is back in front -- broadcast to every window.
	application.RegisterEvent[string]("mill-navigate")
}
