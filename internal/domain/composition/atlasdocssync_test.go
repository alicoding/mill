package composition

import (
	"strings"
	"testing"
)

func TestExecAtlasDocsSync(t *testing.T) {
	node := Node{Config: map[string]string{
		"folderPath": "/tmp/docs", "parentTitle": "Docs space", "kindLabel": "Document", "outputAttribute": "sync_summary",
	}}

	t.Run("syncs via the injected function and stores the summary", func(t *testing.T) {
		restore := atlasDocsSyncFn
		defer func() { atlasDocsSyncFn = restore }()
		var gotFolder, gotParent, gotKind string
		atlasDocsSyncFn = func(folderPath, parentTitle, kindLabel, sourceRunID string) (string, error) {
			gotFolder, gotParent, gotKind = folderPath, parentTitle, kindLabel
			return `{"created":2}`, nil
		}
		out, err := execAtlasDocsSync(node, ExecContext{})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if gotFolder != "/tmp/docs" || gotParent != "Docs space" || gotKind != "Document" {
			t.Errorf("seam received (%q, %q, %q)", gotFolder, gotParent, gotKind)
		}
		if out.Attributes["sync_summary"] != `{"created":2}` {
			t.Errorf("summary not stored: %+v", out.Attributes)
		}
	})

	t.Run("empty folder path is a named error", func(t *testing.T) {
		_, err := execAtlasDocsSync(Node{Config: map[string]string{}}, ExecContext{})
		if err == nil || !strings.Contains(err.Error(), "folderPath is required") {
			t.Fatalf("expected the folderPath-required error, got %v", err)
		}
	})
}
