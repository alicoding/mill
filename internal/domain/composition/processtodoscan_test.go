package composition

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeTodoFixture(t *testing.T, root, rel, content string) {
	t.Helper()
	path := filepath.Join(root, rel)
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
}

// todoScanNode builds a resolved trigger -> process-todo-scan chain
// with the given config overrides layered on the field defaults.
func todoScanNode(t *testing.T, overrides map[string]string) ([]Node, []Edge) {
	t.Helper()
	nodes, edges := chain("trigger-manual", "process-todo-scan")
	resolved, err := ResolveNodeDefaults(nodes)
	if err != nil {
		t.Fatalf("ResolveNodeDefaults returned error: %v", err)
	}
	for i := range resolved {
		if resolved[i].NodeTypeID != "process-todo-scan" {
			continue
		}
		for k, v := range overrides {
			resolved[i].Config[k] = v
		}
	}
	return resolved, edges
}

func TestExecProcessTodoScan_ProducesCSVAndAttributes(t *testing.T) {
	root := t.TempDir()
	writeTodoFixture(t, root, "a.go", "package a\n// TODO: first\nfunc f() {}\n")
	writeTodoFixture(t, root, "sub/b.md", "notes\n# FIXME second\nmore text\n")

	node := Node{ID: "s", NodeTypeID: "process-todo-scan", Config: map[string]string{
		"path": root, "markers": defaultTodoMarkers, "extensions": "", "maxFiles": "5000",
	}}
	ctx, err := execProcessTodoScan(node, ExecContext{})
	if err != nil {
		t.Fatalf("execProcessTodoScan: %v", err)
	}

	want := "file,line,marker,text\na.go,2,TODO,first\nsub/b.md,2,FIXME,second\n"
	if ctx.Payload != want {
		t.Errorf("Payload = %q, want %q", ctx.Payload, want)
	}
	if got := ctx.Attributes["todoCount"]; got != 2 {
		t.Errorf("Attributes[todoCount] = %v, want 2", got)
	}
	if got := ctx.Attributes["todoFiles"]; got != 2 {
		t.Errorf("Attributes[todoFiles] = %v, want 2", got)
	}
}

func TestExecProcessTodoScan_TodoFilesCountsDistinctFilesNotHits(t *testing.T) {
	root := t.TempDir()
	writeTodoFixture(t, root, "a.go", "// TODO: one\n// FIXME: two\n")

	node := Node{ID: "s", NodeTypeID: "process-todo-scan", Config: map[string]string{
		"path": root, "markers": defaultTodoMarkers, "extensions": "", "maxFiles": "5000",
	}}
	ctx, err := execProcessTodoScan(node, ExecContext{})
	if err != nil {
		t.Fatalf("execProcessTodoScan: %v", err)
	}
	if got := ctx.Attributes["todoCount"]; got != 2 {
		t.Errorf("Attributes[todoCount] = %v, want 2", got)
	}
	if got := ctx.Attributes["todoFiles"]; got != 1 {
		t.Errorf("Attributes[todoFiles] = %v, want 1", got)
	}
}

func TestExecProcessTodoScan_PathResolvesAttrBinding(t *testing.T) {
	root := t.TempDir()
	writeTodoFixture(t, root, "a.txt", "TODO: via attribute\n")

	node := Node{ID: "s", NodeTypeID: "process-todo-scan", Config: map[string]string{
		"path": "attr:scanRoot", "markers": defaultTodoMarkers, "extensions": "", "maxFiles": "5000",
	}}
	ctx, err := execProcessTodoScan(node, ExecContext{Attributes: map[string]any{"scanRoot": root}})
	if err != nil {
		t.Fatalf("execProcessTodoScan: %v", err)
	}
	if !strings.Contains(ctx.Payload, "a.txt,1,TODO,via attribute") {
		t.Errorf("Payload = %q, want it to contain the a.txt hit", ctx.Payload)
	}
}

func TestExecProcessTodoScan_EmptyPathErrors(t *testing.T) {
	node := Node{ID: "s", NodeTypeID: "process-todo-scan", Config: map[string]string{
		"path": "", "markers": defaultTodoMarkers, "extensions": "", "maxFiles": "5000",
	}}
	if _, err := execProcessTodoScan(node, ExecContext{}); err == nil {
		t.Fatal("execProcessTodoScan(empty path) returned nil error, want one naming the field")
	} else if !strings.Contains(err.Error(), "path") {
		t.Errorf("error = %q, want it to name the path field", err.Error())
	}
}

func TestExecProcessTodoScan_NotADirectoryErrors(t *testing.T) {
	root := t.TempDir()
	filePath := filepath.Join(root, "file.txt")
	if err := os.WriteFile(filePath, []byte("x"), 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	node := Node{ID: "s", NodeTypeID: "process-todo-scan", Config: map[string]string{
		"path": filePath, "markers": defaultTodoMarkers, "extensions": "", "maxFiles": "5000",
	}}
	if _, err := execProcessTodoScan(node, ExecContext{}); err == nil {
		t.Fatal("execProcessTodoScan(a file, not a directory) returned nil error, want one")
	}
}

func TestExecProcessTodoScan_NonPositiveMaxFilesErrors(t *testing.T) {
	root := t.TempDir()
	node := Node{ID: "s", NodeTypeID: "process-todo-scan", Config: map[string]string{
		"path": root, "markers": defaultTodoMarkers, "extensions": "", "maxFiles": "0",
	}}
	if _, err := execProcessTodoScan(node, ExecContext{}); err == nil {
		t.Fatal("execProcessTodoScan(maxFiles: 0) returned nil error, want one")
	}

	node.Config["maxFiles"] = "not-a-number"
	if _, err := execProcessTodoScan(node, ExecContext{}); err == nil {
		t.Fatal("execProcessTodoScan(maxFiles: not-a-number) returned nil error, want one")
	}
}

func TestExecProcessTodoScan_ExtensionFilter(t *testing.T) {
	root := t.TempDir()
	writeTodoFixture(t, root, "a.go", "// TODO: go file\n")
	writeTodoFixture(t, root, "b.md", "TODO: markdown file\n")

	node := Node{ID: "s", NodeTypeID: "process-todo-scan", Config: map[string]string{
		"path": root, "markers": defaultTodoMarkers, "extensions": "go", "maxFiles": "5000",
	}}
	ctx, err := execProcessTodoScan(node, ExecContext{})
	if err != nil {
		t.Fatalf("execProcessTodoScan: %v", err)
	}
	if strings.Contains(ctx.Payload, "b.md") {
		t.Errorf("Payload = %q, want b.md excluded by the extension filter", ctx.Payload)
	}
	if !strings.Contains(ctx.Payload, "a.go") {
		t.Errorf("Payload = %q, want a.go included", ctx.Payload)
	}
}

func TestTodoScanNode_ResolvesThroughExecuteWorkflow(t *testing.T) {
	root := t.TempDir()
	writeTodoFixture(t, root, "a.txt", "TODO: chain hit\n")

	nodes, edges := todoScanNode(t, map[string]string{"path": root})
	out, err := ExecuteWorkflow(nodes, edges, nil, ExecuteOptions{})
	if err != nil {
		t.Fatalf("ExecuteWorkflow: %v", err)
	}
	if !strings.Contains(out, "a.txt,1,TODO,chain hit") {
		t.Errorf("ExecuteWorkflow result = %q, want it to contain the a.txt hit", out)
	}
}
