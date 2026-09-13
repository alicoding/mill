package pluginsvc

import (
	"testing"

	"github.com/alicoding/mill/internal/services/guardrailsvc"
)

func newTestPluginService(t *testing.T, dir string, guardrail *guardrailsvc.GuardrailService, appVersion string) *PluginService {
	t.Helper()
	service := New(dir, guardrail, appVersion)
	t.Cleanup(func() {
		if err := service.CloseState(); err != nil {
			t.Errorf("CloseState: %v", err)
		}
	})
	return service
}
