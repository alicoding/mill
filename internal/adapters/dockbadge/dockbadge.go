// Package dockbadge wraps Wails3's own dock.DockService behind one
// small Set/Clear-shaped function (docs/adr/0032 §3): the app icon's
// badge mirrors the total pending-decision count (guardrail parks +
// MCP writes) the sidebar already computes, cleared at zero.
//
// Split by !server/server build tag, same shape and reasoning as
// internal/adapters/hotkey and internal/adapters/notify: server mode
// has no dock/taskbar icon to badge regardless of platform (docs/SPEC.md
// §1.3).
package dockbadge
