package atlassvc

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func writeDoc(t *testing.T, dir, name, content string) string {
	t.Helper()
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, []byte(content), 0o600); err != nil {
		t.Fatalf("write %s: %v", name, err)
	}
	return p
}

type docsSyncSummary struct {
	Created   int      `json:"created"`
	Refreshed int      `json:"refreshed"`
	IDs       []string `json:"ids"`
}

func runSync(t *testing.T, a *AtlasService, folder string) docsSyncSummary {
	t.Helper()
	out, err := a.SyncDocsFolder(folder, "Docs space", "Document", "")
	if err != nil {
		t.Fatalf("SyncDocsFolder: %v", err)
	}
	var s docsSyncSummary
	if err := json.Unmarshal([]byte(out), &s); err != nil {
		t.Fatalf("summary is not JSON: %v", err)
	}
	return s
}

// The goal 0108 idempotency contract: first run creates the parent and
// one card per markdown file; a second run over unchanged files
// creates and refreshes nothing; an edited file refreshes its card's
// checksum without creating a duplicate.
func TestSyncDocsFolder_IdempotentByMirrorPath(t *testing.T) {
	a := newTestAtlasService(t)
	dir := t.TempDir()
	one := writeDoc(t, dir, "alpha-notes.md", "# Alpha\n")
	writeDoc(t, dir, "beta-notes.md", "# Beta\n")
	writeDoc(t, dir, "ignored.txt", "not markdown")

	first := runSync(t, a, dir)
	if first.Created != 2 || first.Refreshed != 0 {
		t.Fatalf("first sync = %+v, want 2 created, 0 refreshed", first)
	}
	var parentID string
	for _, c := range a.Cards() {
		if c.Title == "Docs space" {
			parentID = c.ID
		}
	}
	if parentID == "" {
		t.Fatal("parent card was not created")
	}
	for _, c := range a.Cards() {
		if c.MirrorPath != "" && c.ParentID != parentID {
			t.Errorf("mirror card %q landed under %q, want the parent", c.Title, c.ParentID)
		}
	}

	second := runSync(t, a, dir)
	if second.Created != 0 || second.Refreshed != 0 {
		t.Fatalf("second sync = %+v, want nothing created or refreshed", second)
	}

	if err := os.WriteFile(one, []byte("# Alpha edited\n"), 0o600); err != nil {
		t.Fatalf("edit file: %v", err)
	}
	third := runSync(t, a, dir)
	if third.Created != 0 || third.Refreshed != 1 {
		t.Fatalf("third sync = %+v, want 0 created, 1 refreshed", third)
	}
}

func TestSyncDocsFolder_UnknownKindErrors(t *testing.T) {
	a := newTestAtlasService(t)
	if _, err := a.SyncDocsFolder(t.TempDir(), "Docs space", "NoSuchKind", ""); err == nil {
		t.Fatal("expected an error for an unknown kind label")
	}
}
