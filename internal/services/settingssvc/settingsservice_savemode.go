package settingssvc

import "fmt"

// The "Save changes" preference (goal 0295 S2b): how every editing
// surface treats an edit. Kernel config only -- the surfaces and the
// leave handshake (settingsservice_flush.go, shared/flushRegistry.ts)
// read it; nothing here performs a save.

const saveModeKey = "settings-save-mode"

const (
	// SaveModeAutomatic: an edit commits the moment its surface's own
	// commit fires (click-away, Enter, the canvas's draft timer); quit
	// and restart flush whatever is still live and never ask.
	SaveModeAutomatic = "automatic"
	// SaveModeExplicit: an edit waits until the user saves it (⌘S, or
	// Save all on the leave sheet); quit, restart and close hold until
	// the user chooses Save all, Discard or Cancel.
	SaveModeExplicit = "explicit"
)

// GetSaveMode returns the persisted preference; anything but the one
// recognized override reads as automatic, the default.
func (s *SettingsService) GetSaveMode() string {
	if v, ok := s.store.Get(saveModeKey).(string); ok && v == SaveModeExplicit {
		return SaveModeExplicit
	}
	return SaveModeAutomatic
}

// SetSaveMode persists the preference; only the two modes are legal.
func (s *SettingsService) SetSaveMode(mode string) error {
	if mode != SaveModeAutomatic && mode != SaveModeExplicit {
		return fmt.Errorf("unknown save mode %q", mode)
	}
	if err := s.store.Set(saveModeKey, mode); err != nil {
		return fmt.Errorf("save save mode: %w", err)
	}
	return nil
}
