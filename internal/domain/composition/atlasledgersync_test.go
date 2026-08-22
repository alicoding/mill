package composition

import (
	"strings"
	"testing"
)

func TestExecAtlasLedgerSync(t *testing.T) {
	node := Node{Config: map[string]string{
		"folderPath": "/tmp/goals-archive", "parentTitle": "Delivered features", "outputAttribute": "sync_summary",
	}}

	t.Run("syncs via the injected function and stores the summary", func(t *testing.T) {
		restore := atlasLedgerSyncFn
		defer func() { atlasLedgerSyncFn = restore }()
		var gotFolder, gotParent string
		atlasLedgerSyncFn = func(folderPath, parentTitle, sourceRunID string) (string, error) {
			gotFolder, gotParent = folderPath, parentTitle
			return `{"created":2}`, nil
		}
		out, err := execAtlasLedgerSync(node, ExecContext{})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if gotFolder != "/tmp/goals-archive" || gotParent != "Delivered features" {
			t.Errorf("seam received (%q, %q)", gotFolder, gotParent)
		}
		if out.Attributes["sync_summary"] != `{"created":2}` {
			t.Errorf("summary not stored: %+v", out.Attributes)
		}
	})

	t.Run("empty folder path is a named error", func(t *testing.T) {
		_, err := execAtlasLedgerSync(Node{Config: map[string]string{}}, ExecContext{})
		if err == nil || !strings.Contains(err.Error(), "folderPath is required") {
			t.Fatalf("expected the folderPath-required error, got %v", err)
		}
	})
}
