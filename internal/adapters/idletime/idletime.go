// Package idletime reports how long the user has been away from
// keyboard/mouse/trackpad input, system-wide -- the idle-aware half of
// the away-user presence gate (docs/adr/0032's Update,
// docs/goals/0023-attention-escalation.md item 2): "present" now means
// recently-active, not merely "the window has focus" -- a
// focused-but-unattended Mac previously suppressed a decision-blocking
// notification entirely, observed live and named as the bug this
// package exists to fix.
//
// Split by !server/server build tag, same shape and reasoning as
// internal/adapters/hotkey, internal/adapters/notify, and
// internal/adapters/dockbadge: server mode has no HID input stream to
// read regardless of platform (docs/SPEC.md §1.3).
package idletime
