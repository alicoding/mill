package settingssvc

import (
	"encoding/json"
	"log/slog"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/configuresvc"
	"github.com/alicoding/mill/internal/services/mcpsvc"
	"github.com/alicoding/mill/internal/services/servicetest"
	"github.com/alicoding/mill/internal/services/triggersvc"
)

// Real values (a real revision, whether the tree was dirty) are
// inherently environment-dependent -- go test's own binary is built
// the same way go build's is, so this only asserts the mechanism
// doesn't panic and produces *a* value, not a specific one.
func TestReadBuildInfo_DoesNotPanic(t *testing.T) {
	bi := readBuildInfo()
	if len(bi.Revision) > 12 {
		t.Errorf("Revision %q longer than the documented 12-char cap", bi.Revision)
	}
}

// TestReadBuildInfo_BuiltAtIsThisProcessesOwnExecutableMtime (goal
// 0029): `go test` builds and runs a real temporary executable on
// disk, so os.Executable()+os.Stat() must resolve for the test binary
// exactly as it does for a `go build`/`wails3 dev` output -- BuiltAt
// should come back positive, not silently zero.
func TestReadBuildInfo_BuiltAtIsThisProcessesOwnExecutableMtime(t *testing.T) {
	bi := readBuildInfo()
	if bi.BuiltAt <= 0 {
		t.Fatalf("BuiltAt = %d, want a positive unix-millis mtime (os.Executable/os.Stat should resolve for a real test binary)", bi.BuiltAt)
	}
}

// TestExportContract_NilMCPServiceErrors: before SetMCPService is
// called (construction order in main.go always calls it, but the
// nil-check is what makes that ordering safe rather than assumed),
// ExportContract must report a real error, not panic.
func TestExportContract_NilMCPServiceErrors(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	trig := triggersvc.NewTriggerService(comp, slog.Default(), store)
	set := NewSettingsService(store, trig, false)

	if _, err := set.ExportContract(); err == nil {
		t.Error("ExportContract() with no MCP service wired: want an error, got nil")
	}
}

// TestExportContract_DelegatesToMCPService proves the Settings page's
// Export contract action returns the exact same document
// mill://contract serves -- one function underneath both
// (MillMCPService.ContractDocument), not two independent paths.
func TestExportContract_DelegatesToMCPService(t *testing.T) {
	store := servicetest.NewFakeStore()
	comp := compositionsvc.NewCompositionService(store)
	trig := triggersvc.NewTriggerService(comp, slog.Default(), store)
	set := NewSettingsService(store, trig, false)

	cfg := configuresvc.NewConfigureService(store, comp, servicetest.FakeCredentialStore{})
	millMCP := mcpsvc.NewMillMCPService("1.2.3-export-test", comp, cfg, store)
	set.SetMCPService(millMCP)

	got, err := set.ExportContract()
	if err != nil {
		t.Fatalf("ExportContract: %v", err)
	}
	want, err := millMCP.ContractDocument()
	if err != nil {
		t.Fatalf("ContractDocument: %v", err)
	}
	if got != want {
		t.Error("ExportContract() diverges from MillMCPService.ContractDocument()")
	}
	if !strings.Contains(got, "1.2.3-export-test") {
		t.Errorf("ExportContract() missing the wired version:\n%.200s", got)
	}
	var parsed struct {
		NodeTypes []json.RawMessage `json:"nodeTypes"`
	}
	if err := json.Unmarshal([]byte(got), &parsed); err != nil {
		t.Fatalf("ExportContract() not JSON: %v", err)
	}
	if len(parsed.NodeTypes) == 0 {
		t.Error("ExportContract() has no nodeTypes")
	}
}
