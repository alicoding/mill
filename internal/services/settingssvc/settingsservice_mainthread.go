package settingssvc

// Split out of settingsservice.go once that file crossed the 500-line
// limit (.claude/rules/architecture.md), same "split along a real seam"
// shape as settingsservice_buildinfo.go before it. No behavior change:
// mainThreadRun (the field this file's methods read/write) is still
// declared on *SettingsService in settingsservice.go, still guarded by
// the same s.mu the rest of the service uses.
//
// The seam exists because application.App-level Show/Hide (as opposed
// to a *WebviewWindow's own Show/Hide) perform raw cgo calls straight
// into AppKit with no main-thread marshal of their own -- see
// settingsservice_panel.go's doc comment for the full reasoning and the
// pinned-source citations.

// SetMainThreadRunner overrides mainThreadRun's default direct-call
// stub with a real dispatcher once a live application.App exists.
// Called once from main.go, after application.New() -- pass
// application.InvokeSync directly, its signature already matches.
//
//wails:ignore
func (s *SettingsService) SetMainThreadRunner(run func(func())) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if run != nil {
		s.mainThreadRun = run
	}
}

// runOnMainThread reads the current mainThreadRun seam under lock and
// invokes fn through it -- the single call path every app-level
// Show/Hide call in this package uses (settingsservice_panel.go's doc
// comment has the full reasoning).
func (s *SettingsService) runOnMainThread(fn func()) {
	s.mu.Lock()
	run := s.mainThreadRun
	s.mu.Unlock()
	run(fn)
}
