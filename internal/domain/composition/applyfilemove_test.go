package composition

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// applyFileMoveNode builds a resolved trigger -> apply-file-move chain
// with the given config overrides layered on the field defaults, ready
// to run through ExecuteWorkflow -- mirrors applyFileWriteNode
// (applyfilewrite_test.go).
func applyFileMoveNode(t *testing.T, overrides map[string]string) ([]Node, []Edge) {
	t.Helper()
	nodes, edges := chain("trigger-manual", "apply-file-move")
	resolved, err := ResolveNodeDefaults(nodes)
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	for i := range resolved {
		if resolved[i].NodeTypeID != "apply-file-move" {
			continue
		}
		for k, v := range overrides {
			resolved[i].Config[k] = v
		}
	}
	return resolved, edges
}

var fixedNow = time.Date(2026, 3, 7, 15, 4, 5, 0, time.UTC)

func TestExpandPathTemplate_Filename(t *testing.T) {
	got, err := expandPathTemplate("/out/{filename}", "/in/report.pdf", nil, fixedNow)
	if err != nil {
		t.Fatalf("expandPathTemplate: %v", err)
	}
	if want := "/out/report.pdf"; got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestExpandPathTemplate_Name(t *testing.T) {
	got, err := expandPathTemplate("/out/{name}-copy", "/in/report.pdf", nil, fixedNow)
	if err != nil {
		t.Fatalf("expandPathTemplate: %v", err)
	}
	if want := "/out/report-copy"; got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestExpandPathTemplate_Ext(t *testing.T) {
	got, err := expandPathTemplate("/out/renamed{ext}", "/in/report.pdf", nil, fixedNow)
	if err != nil {
		t.Fatalf("expandPathTemplate: %v", err)
	}
	if want := "/out/renamed.pdf"; got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestExpandPathTemplate_ExtNoExtension_Empty(t *testing.T) {
	got, err := expandPathTemplate("/out/renamed{ext}", "/in/README", nil, fixedNow)
	if err != nil {
		t.Fatalf("expandPathTemplate: %v", err)
	}
	if want := "/out/renamed"; got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestExpandPathTemplate_Date(t *testing.T) {
	got, err := expandPathTemplate("/out/{date:2006-01-02}/{filename}", "/in/report.pdf", nil, fixedNow)
	if err != nil {
		t.Fatalf("expandPathTemplate: %v", err)
	}
	if want := "/out/2026-03-07/report.pdf"; got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestExpandPathTemplate_DateEmptyLayout_Errors(t *testing.T) {
	if _, err := expandPathTemplate("/out/{date:}/{filename}", "/in/report.pdf", nil, fixedNow); err == nil {
		t.Fatal("expandPathTemplate() error = nil, want an error for an empty date layout")
	}
}

func TestExpandPathTemplate_Attr(t *testing.T) {
	got, err := expandPathTemplate("/out/{attr:category}/{filename}", "/in/report.pdf", map[string]string{"category": "invoices"}, fixedNow)
	if err != nil {
		t.Fatalf("expandPathTemplate: %v", err)
	}
	if want := "/out/invoices/report.pdf"; got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestExpandPathTemplate_AttrMissing_ResolvesEmpty(t *testing.T) {
	got, err := expandPathTemplate("/out/{attr:missing}{filename}", "/in/report.pdf", nil, fixedNow)
	if err != nil {
		t.Fatalf("expandPathTemplate: %v", err)
	}
	if want := "/out/report.pdf"; got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestExpandPathTemplate_UnknownToken_Errors(t *testing.T) {
	_, err := expandPathTemplate("/out/{bogus}/{filename}", "/in/report.pdf", nil, fixedNow)
	if err == nil {
		t.Fatal("expandPathTemplate() error = nil, want an error for an unknown token")
	}
	if !strings.Contains(err.Error(), "bogus") {
		t.Errorf("error = %q, want it to name the bad token", err.Error())
	}
}

func TestExpandPathTemplate_UnterminatedToken_Errors(t *testing.T) {
	if _, err := expandPathTemplate("/out/{filename", "/in/report.pdf", nil, fixedNow); err == nil {
		t.Fatal("expandPathTemplate() error = nil, want an error for an unterminated token")
	}
}

func TestExpandPathTemplate_TrailingSlash_KeepsSourceFilename(t *testing.T) {
	got, err := expandPathTemplate("/out/", "/in/report.pdf", nil, fixedNow)
	if err != nil {
		t.Fatalf("expandPathTemplate: %v", err)
	}
	if want := "/out/report.pdf"; got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestExpandPathTemplate_ExistingDirectory_KeepsSourceFilename(t *testing.T) {
	dir := t.TempDir()
	got, err := expandPathTemplate(dir, "/in/report.pdf", nil, fixedNow)
	if err != nil {
		t.Fatalf("expandPathTemplate: %v", err)
	}
	if want := filepath.Join(dir, "report.pdf"); got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestExpandPathTemplate_EmptyTemplate_Errors(t *testing.T) {
	if _, err := expandPathTemplate("", "/in/report.pdf", nil, fixedNow); err == nil {
		t.Fatal("expandPathTemplate() error = nil, want an error for an empty destination")
	}
}

func TestApplyFileMove_HappyPath_MovesFile(t *testing.T) {
	srcDir, dstDir := t.TempDir(), t.TempDir()
	src := filepath.Join(srcDir, "report.pdf")
	if err := os.WriteFile(src, []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(dstDir, "report.pdf")
	nodes, edges := applyFileMoveNode(t, map[string]string{"sourcePath": src, "destination": dst})

	out, err := ExecuteWorkflow(nodes, edges, nil, ExecuteOptions{})
	if err != nil {
		t.Fatalf("ExecuteWorkflow: %v", err)
	}
	if out != dst {
		t.Errorf("ExecuteWorkflow result = %q, want the new path %q", out, dst)
	}
	if _, err := os.Stat(src); !os.IsNotExist(err) {
		t.Errorf("source still exists after move: %v", err)
	}
	got, err := os.ReadFile(dst) //nolint:gosec // t.TempDir()-scoped test fixture path, not user input
	if err != nil {
		t.Fatalf("ReadFile(dst): %v", err)
	}
	if string(got) != "hello" {
		t.Errorf("dst content = %q, want %q", got, "hello")
	}
}

func TestApplyFileMove_EmptySourcePath_UsesPayload(t *testing.T) {
	srcDir, dstDir := t.TempDir(), t.TempDir()
	src := filepath.Join(srcDir, "report.pdf")
	if err := os.WriteFile(src, []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(dstDir, "report.pdf")
	nodes, edges := applyFileMoveNode(t, map[string]string{"destination": dst})

	out, err := ExecuteWorkflow(nodes, edges, nil, ExecuteOptions{InitialPayload: src})
	if err != nil {
		t.Fatalf("ExecuteWorkflow: %v", err)
	}
	if out != dst {
		t.Errorf("ExecuteWorkflow result = %q, want %q", out, dst)
	}
}

func TestApplyFileMove_AttrSourcePath(t *testing.T) {
	srcDir, dstDir := t.TempDir(), t.TempDir()
	src := filepath.Join(srcDir, "report.pdf")
	if err := os.WriteFile(src, []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(dstDir, "report.pdf")
	nodes, edges := applyFileMoveNode(t, map[string]string{"sourcePath": "attr:incomingPath", "destination": dst})

	out, err := ExecuteWorkflow(nodes, edges, []AttributeDef{{Key: "incomingPath", Label: "Path", Type: FieldText}},
		ExecuteOptions{AttrValues: map[string]string{"incomingPath": src}})
	if err != nil {
		t.Fatalf("ExecuteWorkflow: %v", err)
	}
	if out != dst {
		t.Errorf("ExecuteWorkflow result = %q, want %q", out, dst)
	}
}

func TestApplyFileMove_EmptySourcePathAndPayload_Errors(t *testing.T) {
	nodes, edges := applyFileMoveNode(t, map[string]string{"destination": filepath.Join(t.TempDir(), "out.txt")})

	_, err := ExecuteWorkflow(nodes, edges, nil, ExecuteOptions{})
	if err == nil {
		t.Fatal("ExecuteWorkflow() error = nil, want an error for no source path and no payload")
	}
	if want := "apply-file-move: "; !strings.Contains(err.Error(), want) {
		t.Errorf("error = %q, want it to contain %q", err.Error(), want)
	}
}

func TestApplyFileMove_OnConflictFail_ErrorsWhenDestinationExists(t *testing.T) {
	srcDir, dstDir := t.TempDir(), t.TempDir()
	src := filepath.Join(srcDir, "report.pdf")
	if err := os.WriteFile(src, []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(dstDir, "report.pdf")
	if err := os.WriteFile(dst, []byte("existing"), 0o600); err != nil {
		t.Fatal(err)
	}
	nodes, edges := applyFileMoveNode(t, map[string]string{"sourcePath": src, "destination": dst, "onConflict": "fail"})

	_, err := ExecuteWorkflow(nodes, edges, nil, ExecuteOptions{})
	if err == nil {
		t.Fatal("ExecuteWorkflow() error = nil, want an error when the destination already exists and onConflict is fail")
	}
}

func TestApplyFileMove_OnConflictSuffix_CollidesTwice_UsesThirdCandidate(t *testing.T) {
	srcDir, dstDir := t.TempDir(), t.TempDir()
	src := filepath.Join(srcDir, "report.pdf")
	if err := os.WriteFile(src, []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(dstDir, "report.pdf")
	if err := os.WriteFile(dst, []byte("existing"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dstDir, "report (2).pdf"), []byte("existing 2"), 0o600); err != nil {
		t.Fatal(err)
	}
	nodes, edges := applyFileMoveNode(t, map[string]string{"sourcePath": src, "destination": dst, "onConflict": "suffix"})

	out, err := ExecuteWorkflow(nodes, edges, nil, ExecuteOptions{})
	if err != nil {
		t.Fatalf("ExecuteWorkflow: %v", err)
	}
	want := filepath.Join(dstDir, "report (3).pdf")
	if out != want {
		t.Errorf("ExecuteWorkflow result = %q, want %q", out, want)
	}
}

func TestApplyFileMove_CreateDirsFalse_MissingDestDir_Errors(t *testing.T) {
	srcDir := t.TempDir()
	src := filepath.Join(srcDir, "report.pdf")
	if err := os.WriteFile(src, []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(srcDir, "missing-subdir", "report.pdf")
	nodes, edges := applyFileMoveNode(t, map[string]string{"sourcePath": src, "destination": dst, "createDirs": "false"})

	_, err := ExecuteWorkflow(nodes, edges, nil, ExecuteOptions{})
	if err == nil {
		t.Fatal("ExecuteWorkflow() error = nil, want an error for a missing destination folder with createDirs off")
	}
}

func TestApplyFileMove_CreateDirsTrue_CreatesNestedParents(t *testing.T) {
	srcDir := t.TempDir()
	src := filepath.Join(srcDir, "report.pdf")
	if err := os.WriteFile(src, []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(srcDir, "a", "b", "c", "report.pdf")
	nodes, edges := applyFileMoveNode(t, map[string]string{"sourcePath": src, "destination": dst, "createDirs": "true"})

	if _, err := ExecuteWorkflow(nodes, edges, nil, ExecuteOptions{}); err != nil {
		t.Fatalf("ExecuteWorkflow: %v", err)
	}
	if _, err := os.Stat(dst); err != nil {
		t.Errorf("os.Stat(dst) = %v, want the nested file to exist", err)
	}
}
