package configuresvc

import (
	"reflect"
	"testing"

	"github.com/alicoding/mill/internal/domain/execenv"
	"github.com/alicoding/mill/internal/domain/httprequest"
	"github.com/alicoding/mill/internal/domain/secret"
)

// setLabels wires cfg's title lookup (secretLabelsLister) to a fixed,
// in-test map of vault id -> title -- DeriveSecretLabels' own read
// (goal 0203 S2), standing in for a real unlocked vault's List().
func setLabels(cfg *ConfigureService, titles map[string]string) {
	cfg.SetSecretLabelsLister(func() ([]secret.Summary, error) {
		out := make([]secret.Summary, 0, len(titles))
		for id, title := range titles {
			out = append(out, secret.Summary{ID: id, Title: title})
		}
		return out, nil
	})
}

func TestDeriveSecretLabels_MCPServerEnv_ResolvesLabel(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	setLabels(cfg, map[string]string{"entry-1": "GitHub PAT"})

	s, err := cfg.CreateMCPServer("Server", "cmd", nil, []string{"TOKEN=vault:entry-1"})
	if err != nil {
		t.Fatalf("CreateMCPServer: %v", err)
	}

	got := cfg.DeriveSecretLabels("mcp-tool-call", map[string]string{"mcpServerId": s.ID})
	want := []string{"GitHub PAT"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("DeriveSecretLabels(mcp-tool-call) = %v, want %v", got, want)
	}
}

func TestDeriveSecretLabels_ExecEnvEnv_ResolvesLabel(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	setLabels(cfg, map[string]string{"entry-2": "Deploy key"})

	e, err := cfg.CreateExecEnv("Sandbox", execenv.ShellSh, execenv.ProfileClean, execenv.TempDirSentinel, []string{"KEY=vault:entry-2"})
	if err != nil {
		t.Fatalf("CreateExecEnv: %v", err)
	}

	got := cfg.DeriveSecretLabels("code-execution", map[string]string{"envId": e.ID})
	want := []string{"Deploy key"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("DeriveSecretLabels(code-execution) = %v, want %v", got, want)
	}
}

func TestDeriveSecretLabels_HTTPRequestHeaders_ResolvesLabel(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	setLabels(cfg, map[string]string{"entry-3": "API key"})

	r, err := cfg.CreateHTTPRequest("Request", "https://example.com", "GET", "", httprequest.AuthNone,
		map[string]string{"X-Api-Key": "vault:entry-3"}, "", nil, nil, "")
	if err != nil {
		t.Fatalf("CreateHTTPRequest: %v", err)
	}

	got := cfg.DeriveSecretLabels("integration-http", map[string]string{"requestId": r.ID})
	want := []string{"API key"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("DeriveSecretLabels(integration-http) = %v, want %v", got, want)
	}
}

// TestDeriveSecretLabels_DanglingID_YieldsPlaceholder covers a
// "vault:<id>" reference DeriveSecretLabels can't currently attach a
// real title to -- a genuinely deleted vault entry and (this test's
// case) a locked/never-set-up vault both take this path, since
// setLabels above is never called: secretLabelsLister defaults to
// reporting no titles known.
func TestDeriveSecretLabels_DanglingID_YieldsPlaceholder(t *testing.T) {
	cfg, _ := newTestConfigureService(t)

	e, err := cfg.CreateExecEnv("Sandbox", execenv.ShellSh, execenv.ProfileClean, execenv.TempDirSentinel, []string{"KEY=vault:no-such-entry"})
	if err != nil {
		t.Fatalf("CreateExecEnv: %v", err)
	}

	got := cfg.DeriveSecretLabels("code-execution", map[string]string{"envId": e.ID})
	want := []string{unknownVaultLabel}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("DeriveSecretLabels(dangling id) = %v, want %v", got, want)
	}
}

// TestDeriveSecretLabels_NoRefs_ReturnsEmptyNotNil proves the
// "present, possibly empty" contract GuardrailStep depends on: a step
// that touches no secret still gets a real, non-nil empty slice, never
// a nil the caller would have to special-case.
func TestDeriveSecretLabels_NoRefs_ReturnsEmptyNotNil(t *testing.T) {
	cfg, _ := newTestConfigureService(t)

	e, err := cfg.CreateExecEnv("Sandbox", execenv.ShellSh, execenv.ProfileClean, execenv.TempDirSentinel, []string{"PATH=/usr/bin"})
	if err != nil {
		t.Fatalf("CreateExecEnv: %v", err)
	}

	got := cfg.DeriveSecretLabels("code-execution", map[string]string{"envId": e.ID})
	if got == nil || len(got) != 0 {
		t.Errorf("DeriveSecretLabels(no refs) = %#v, want a non-nil empty slice", got)
	}
}

// TestDeriveSecretLabels_UnrecognizedNodeType_ReturnsEmpty covers a
// node type outside the three ref kinds (mcp-tool-call/code-execution/
// integration-http) -- e.g. a trigger or a pure-transform step never
// resolves a vault reference at all.
func TestDeriveSecretLabels_UnrecognizedNodeType_ReturnsEmpty(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	got := cfg.DeriveSecretLabels("trigger-manual", map[string]string{})
	if got == nil || len(got) != 0 {
		t.Errorf("DeriveSecretLabels(trigger-manual) = %#v, want a non-nil empty slice", got)
	}
}

// TestDeriveSecretLabels_DuplicateRefs_DedupedAndSorted proves both
// halves of the "sorted, deduped labels" contract: the SAME id
// referenced twice collapses to one label, and multiple distinct
// labels come back alphabetically ordered regardless of Env order.
func TestDeriveSecretLabels_DuplicateRefs_DedupedAndSorted(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	setLabels(cfg, map[string]string{"entry-z": "Zendesk token", "entry-a": "AWS key"})

	e, err := cfg.CreateExecEnv("Sandbox", execenv.ShellSh, execenv.ProfileClean, execenv.TempDirSentinel,
		[]string{"ONE=vault:entry-z", "TWO=vault:entry-a", "THREE=vault:entry-z"})
	if err != nil {
		t.Fatalf("CreateExecEnv: %v", err)
	}

	got := cfg.DeriveSecretLabels("code-execution", map[string]string{"envId": e.ID})
	want := []string{"AWS key", "Zendesk token"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("DeriveSecretLabels(duplicate refs) = %v, want %v", got, want)
	}
}
