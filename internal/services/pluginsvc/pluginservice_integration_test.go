package pluginsvc

import (
	"strings"
	"testing"
)

func TestCallIntegrationForPlugin_RefusesUndeclaredCapability(t *testing.T) {
	svc, _, exec := newGuardedWriteHarness(t)
	if _, err := svc.CallIntegrationForPlugin("plain", "int-1", "/search", "GET", nil); err == nil || !strings.Contains(err.Error(), "call-integration") {
		t.Errorf("undeclared capability must refuse naming it: %v", err)
	}
	if len(exec.calls) != 0 {
		t.Fatalf("a refused call must never reach the integration door: %v", exec.calls)
	}
}

func TestCallIntegrationForPlugin_ReadsThroughNoGuardrail(t *testing.T) {
	svc, _, exec := newGuardedWriteHarness(t)
	body, err := svc.CallIntegrationForPlugin("tracker-view", "int-1", "/search", "GET", map[string]string{"q": "assignee = me"})
	if err != nil {
		t.Fatalf("CallIntegrationForPlugin returned error: %v", err)
	}
	if body != `{"ok":true}` {
		t.Errorf("body = %q, want the executor's response", body)
	}
	if len(exec.calls) != 1 || exec.calls[0].requestID != "int-1" || exec.calls[0].path != "/search" || exec.calls[0].method != "GET" {
		t.Fatalf("the integration door saw %+v, want one GET /search", exec.calls)
	}
}

func TestCallIntegrationForPlugin_NoIntegrationsWired_Errors(t *testing.T) {
	svc, _, _ := newGuardedWriteHarness(t)
	svc.WireIntegrations(nil)
	if _, err := svc.CallIntegrationForPlugin("tracker-view", "int-1", "/search", "GET", nil); err == nil || !strings.Contains(err.Error(), "not available") {
		t.Errorf("no integrations wired must refuse: %v", err)
	}
}
