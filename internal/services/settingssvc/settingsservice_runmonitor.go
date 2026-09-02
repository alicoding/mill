package settingssvc

import "github.com/alicoding/mill/internal/adapters/windowing"

// RunMonitorTarget is the event payload the run monitor window
// renders: one workflow's canvas showing one run ("latest" = the
// workflow's newest run, whatever its state).
type RunMonitorTarget struct {
	WorkflowID string `json:"workflowID"`
	RunID      string `json:"runID"`
}

// SetRunMonitorWindow wires the run monitor window (auxwindows.go's
// newRunMonitorWindow) -- goal 0294 S2.
func (s *SettingsService) SetRunMonitorWindow(w *windowing.Window) {
	s.mu.Lock()
	s.runMonitor = w
	s.mu.Unlock()
}

// ShowRunMonitor points the monitor at a run and brings it forward.
// The target is emitted first so a hidden-but-alive page has it before
// it is shown; a visible monitor simply switches target.
func (s *SettingsService) ShowRunMonitor(workflowID, runID string) {
	s.mu.Lock()
	w := s.runMonitor
	s.mu.Unlock()
	windowing.Emit("mill-run-monitor", RunMonitorTarget{WorkflowID: workflowID, RunID: runID})
	if w == nil {
		return
	}
	bringFloatingToFront(w)
}

// HideRunMonitor is the monitor's own "Open in Mill" hand-off: hide
// this window, then the caller opens the main window on the run.
func (s *SettingsService) HideRunMonitor() {
	s.mu.Lock()
	w := s.runMonitor
	s.mu.Unlock()
	if w != nil {
		w.Hide()
	}
}
