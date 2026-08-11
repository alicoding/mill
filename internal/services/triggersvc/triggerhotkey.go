package triggersvc

import "github.com/alicoding/mill/internal/adapters/hotkey"

// Schema registers from internal/domain/composition/triggers.go, not
// here -- see that file's doc comment.
func init() {
	RegisterTrigger("trigger-hotkey", func(s *TriggerService, workflowID string, _ map[string]string) (*activeListener, error) {
		hk, ok := s.hkRaw[workflowID]
		if !ok {
			return nil, nil // no combo assigned yet
		}
		label := FormatBinding(hk.Mods, hk.Key)
		b, err := hotkey.Bind(hk.Mods, hk.Key)
		if err != nil {
			return nil, err
		}
		go func(id string) {
			for range b.Keydown() {
				s.fire(id, label, "")
			}
		}(workflowID)
		return &activeListener{hotkey: b}, nil
	})
}
