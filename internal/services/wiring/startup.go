package wiring

import (
	"log/slog"

	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/mcpsvc"
	"github.com/alicoding/mill/internal/services/settingssvc"
	"github.com/alicoding/mill/internal/services/triggersvc"
)

// ApplicationStarted is everything that must wait for the native run
// loop to be spinning: global hotkey registration needs it (docs/
// SPEC.md §2.2), and ServiceStartup runs before the loop starts.
// TriggerService.Sync registers the non-hotkey trigger types from here
// too, for one uniform startup path.
//
// Lives here rather than inline in main.go's event handler so main.go
// stays the embed/window/service-wiring file it is documented to be;
// the toolkit type the handler receives never crosses this boundary
// (depguard confines that import to internal/adapters and main).
func ApplicationStarted(triggers *triggersvc.TriggerService, comp *compositionsvc.CompositionService, settings *settingssvc.SettingsService, mill *mcpsvc.MillMCPService, logger *slog.Logger) {
	triggers.Sync(comp.Workflows())
	SubscribeMCPPluginReload(mill) // needs the running event bus (docs/goals/0324)
	settings.RestoreSummonHotkey()
	// docs/goals/0016-keymap-system.md: releases the native File >
	// Close (⌘W) accelerator so the keypress falls through to the
	// keymap's own command dispatch (tab.close) instead of being
	// intercepted by NSMenu first -- must run before any hotkey recorder
	// could call SuspendMenuAccelerators (ReleaseMenuAccelerators's own
	// doc comment has the ordering reasoning). This covers the window
	// before the page installs its own projected menu (docs/goals/0332),
	// which carries no Close role at all. View > Reload (⌘R/⌘⇧R) is
	// deliberately left alone: workflow.run's default is ⌘↩, not ⌘R.
	settings.ReleaseMenuAccelerators()
	// docs/adr/0032 §3: the away-user attention layer's OS-notification
	// half. A failure here (a bare dev binary with no real bundle ID, or
	// server mode) is logged, never fatal.
	if err := settings.SetupAwayAttention(); err != nil {
		logger.Warn("away-attention notifications setup", "error", err)
	}
}
