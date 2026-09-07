package auditsvc

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/audit"
)

func openTestService(t *testing.T) *AuditService {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "execution.db")
	svc, err := New(dbPath, 10000, nil)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(func() { _ = svc.Close() })
	return svc
}

func TestExportAuditTrail_ContainsEveryKindByDefault(t *testing.T) {
	svc := openTestService(t)
	for _, k := range []audit.Kind{audit.KindMCPCall, audit.KindSecretAccess, audit.KindBridgeCommand} {
		if _, err := svc.store.Append(context.Background(), audit.Entry{Kind: k, Action: "a", Outcome: "accepted"}); err != nil {
			t.Fatalf("Append(%s): %v", k, err)
		}
	}

	out, err := svc.ExportAuditTrail(nil)
	if err != nil {
		t.Fatalf("ExportAuditTrail: %v", err)
	}
	lines := strings.Split(strings.TrimRight(out, "\n"), "\n")
	if len(lines) != 3 {
		t.Fatalf("got %d lines, want 3: %q", len(lines), out)
	}
	seen := map[string]bool{}
	for _, line := range lines {
		var row exportRow
		if err := json.Unmarshal([]byte(line), &row); err != nil {
			t.Fatalf("line %q did not decode as JSON: %v", line, err)
		}
		seen[row.Kind] = true
	}
	for _, k := range []string{"mcp-call", "secret-access", "bridge-command"} {
		if !seen[k] {
			t.Errorf("export missing a %q row: %q", k, out)
		}
	}
}

func TestExportAuditTrail_HonoursKindFilter(t *testing.T) {
	svc := openTestService(t)
	if _, err := svc.store.Append(context.Background(), audit.Entry{Kind: audit.KindMCPCall, Action: "tools/call", Outcome: "success"}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.store.Append(context.Background(), audit.Entry{Kind: audit.KindBridgeCommand, Action: "pair", Outcome: "accepted"}); err != nil {
		t.Fatal(err)
	}

	out, err := svc.ExportAuditTrail([]string{"bridge-command"})
	if err != nil {
		t.Fatalf("ExportAuditTrail: %v", err)
	}
	lines := strings.Split(strings.TrimRight(out, "\n"), "\n")
	if len(lines) != 1 {
		t.Fatalf("got %d lines, want 1: %q", len(lines), out)
	}
	var row exportRow
	if err := json.Unmarshal([]byte(lines[0]), &row); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if row.Kind != "bridge-command" || row.Action != "pair" {
		t.Errorf("row = %+v, want the bridge-command/pair row only", row)
	}
}

func TestExportAuditTrail_PagesPastOnePage(t *testing.T) {
	svc := openTestService(t)
	const rows = exportPageSize + 3
	for i := 0; i < rows; i++ {
		if _, err := svc.store.Append(context.Background(), audit.Entry{Kind: audit.KindMCPCall, Action: "tools/call", Outcome: "success"}); err != nil {
			t.Fatal(err)
		}
	}
	out, err := svc.ExportAuditTrail(nil)
	if err != nil {
		t.Fatalf("ExportAuditTrail: %v", err)
	}
	lines := strings.Split(strings.TrimRight(out, "\n"), "\n")
	if len(lines) != rows {
		t.Fatalf("got %d lines, want %d (export must page past one List call)", len(lines), rows)
	}
}

func TestExportAuditTrail_Empty(t *testing.T) {
	svc := openTestService(t)
	out, err := svc.ExportAuditTrail(nil)
	if err != nil {
		t.Fatalf("ExportAuditTrail: %v", err)
	}
	if out != "" {
		t.Errorf("empty trail exported %q, want empty string", out)
	}
}

// TestNew_PrunesAcrossEveryKindAtBoot is goal 0351 Decision 4's
// proof: the shared cap applies to the WHOLE table, not per kind.
func TestNew_PrunesAcrossEveryKindAtBoot(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "execution.db")
	seed, err := New(dbPath, 10000, nil)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		if _, err := seed.store.Append(context.Background(), audit.Entry{Kind: audit.KindMCPCall}); err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 3; i++ {
		if _, err := seed.store.Append(context.Background(), audit.Entry{Kind: audit.KindSecretAccess}); err != nil {
			t.Fatal(err)
		}
	}
	if err := seed.Close(); err != nil {
		t.Fatal(err)
	}

	// Re-open with a cap smaller than the 6 rows already written -- the
	// SAME construction-time prune mcpauditsvc.New's own boot-prune uses.
	pruned, err := New(dbPath, 2, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = pruned.Close() })
	out, err := pruned.ExportAuditTrail(nil)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimRight(out, "\n"), "\n")
	if len(lines) != 2 {
		t.Fatalf("got %d rows after a boot prune to keep=2, want 2: %q", len(lines), out)
	}
}
