package settingssvc

import (
	"encoding/json"
	"strings"

	"github.com/alicoding/mill/internal/adapters/windowing"
)

// The capture window (goal 0309): a floating window summoned from the
// Quick Panel or the palette that renders one capture face -- the
// built-in note, or a plugin's -- and lands the result where the user
// chose. Show/hide choreography lives here like the run monitor's.

// CaptureTarget is the event payload the capture window renders.
// PluginID "" with CaptureID "note" is Mill's own note capture.
type CaptureTarget struct {
	PluginID  string `json:"pluginID"`
	CaptureID string `json:"captureID"`
}

// captureDestinationsKey persists where each capture lands, keyed by
// "note" or "<pluginId>/<captureId>" -- a card id, or "" for the top
// level. Remembered per capture kind, last used wins.
const captureDestinationsKey = "settings-capture-destinations"

// SetCaptureWindow wires the window (auxwindows.go's newCaptureWindow).
//
//wails:ignore
func (s *SettingsService) SetCaptureWindow(w *windowing.Window) {
	s.mu.Lock()
	s.capture = w
	s.mu.Unlock()
}

// ShowCapture points the window at a capture and brings it forward;
// the target is emitted first so a hidden-but-alive page has it before
// it is shown.
func (s *SettingsService) ShowCapture(pluginID, captureID string) {
	s.mu.Lock()
	w := s.capture
	s.mu.Unlock()
	windowing.Emit("mill-capture", CaptureTarget{PluginID: pluginID, CaptureID: captureID})
	if w == nil {
		return
	}
	bringFloatingToFront(w)
}

// HideCapture is the window's own Save/Cancel hand-off.
func (s *SettingsService) HideCapture() {
	s.mu.Lock()
	w := s.capture
	s.mu.Unlock()
	if w != nil {
		w.Hide()
	}
}

// GetCaptureDestinations returns every remembered destination. Never
// nil.
func (s *SettingsService) GetCaptureDestinations() map[string]string {
	out := map[string]string{}
	raw, ok := s.store.Get(captureDestinationsKey).(string)
	if !ok || raw == "" {
		return out
	}
	if err := json.Unmarshal([]byte(raw), &out); err != nil || out == nil {
		return map[string]string{}
	}
	return out
}

// SetCaptureDestination remembers where key's captures land.
func (s *SettingsService) SetCaptureDestination(key, parentID string) error {
	key = strings.TrimSpace(key)
	if key == "" {
		return nil
	}
	all := s.GetCaptureDestinations()
	all[key] = parentID
	data, err := json.Marshal(all)
	if err != nil {
		return err
	}
	return s.store.Set(captureDestinationsKey, string(data))
}
