package main

import (
	"context"
	"errors"
	"net"
	"os"
	"path/filepath"
	"testing"
)

func TestRepoRootFrom(t *testing.T) {
	t.Run("finds go.mod in an ancestor directory", func(t *testing.T) {
		root := t.TempDir()
		if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module x\n"), 0o600); err != nil {
			t.Fatalf("write go.mod: %v", err)
		}
		nested := filepath.Join(root, "a", "b", "c")
		if err := os.MkdirAll(nested, 0o750); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
		got, err := repoRootFrom(nested)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		// Both sides may carry a macOS /private symlink prefix
		// inconsistently -- EvalSymlinks normalizes both before compare.
		wantResolved, _ := filepath.EvalSymlinks(root)
		gotResolved, _ := filepath.EvalSymlinks(got)
		if gotResolved != wantResolved {
			t.Errorf("got %q, want %q", got, root)
		}
	})

	t.Run("errors when no go.mod exists above the start dir", func(t *testing.T) {
		root := t.TempDir()
		nested := filepath.Join(root, "a", "b")
		if err := os.MkdirAll(nested, 0o750); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
		if _, err := repoRootFrom(nested); err == nil {
			t.Fatal("expected an error when no go.mod is found")
		}
	})
}

func TestAsBridgeGapError(t *testing.T) {
	t.Run("matches a *bridgeGapError", func(t *testing.T) {
		var gap *bridgeGapError
		err := error(&bridgeGapError{tool: "x", message: "unknown tool: x"})
		if !asBridgeGapError(err, &gap) || gap.tool != "x" {
			t.Fatalf("expected a match, got gap=%+v", gap)
		}
	})

	t.Run("does not match a plain error", func(t *testing.T) {
		var gap *bridgeGapError
		if asBridgeGapError(errors.New("boom"), &gap) {
			t.Fatal("a plain error must never be misclassified as a bridge gap")
		}
	})
}

func TestRunRegistry(t *testing.T) {
	t.Run("all checks passing returns nil", func(t *testing.T) {
		checks := []check{
			{name: "a", reason: "r", run: func(mcpCaller) (string, error) { return "ok", nil }},
			{name: "b", reason: "r", run: func(mcpCaller) (string, error) { return "ok", nil }},
		}
		if err := runRegistry(newFakeCaller(), checks); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	})

	t.Run("a failing check is reported but later checks still run", func(t *testing.T) {
		ran := map[string]bool{}
		checks := []check{
			{name: "a", reason: "r", run: func(mcpCaller) (string, error) { ran["a"] = true; return "", errors.New("nope") }},
			{name: "b", reason: "r", run: func(mcpCaller) (string, error) { ran["b"] = true; return "ok", nil }},
		}
		err := runRegistry(newFakeCaller(), checks)
		if err == nil {
			t.Fatal("expected an aggregate error when a check fails")
		}
		if !ran["a"] || !ran["b"] {
			t.Fatalf("expected both checks to run, got %+v", ran)
		}
	})

	t.Run("a bridge gap stops the registry immediately, never substituted", func(t *testing.T) {
		ran := map[string]bool{}
		checks := []check{
			{name: "a", reason: "r", run: func(mcpCaller) (string, error) {
				ran["a"] = true
				return "", &bridgeGapError{tool: "dom_query", message: "unknown tool: dom_query"}
			}},
			{name: "b", reason: "r", run: func(mcpCaller) (string, error) { ran["b"] = true; return "ok", nil }},
		}
		err := runRegistry(newFakeCaller(), checks)
		if err == nil {
			t.Fatal("expected an error")
		}
		if ran["b"] {
			t.Fatal("a bridge gap must stop the registry before later checks run")
		}
	})
}

func TestPortInUse(t *testing.T) {
	listen := func(t *testing.T) net.Listener {
		t.Helper()
		var lc net.ListenConfig
		ln, err := lc.Listen(context.Background(), "tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatalf("listen: %v", err)
		}
		return ln
	}

	t.Run("true for a port something is actually listening on", func(t *testing.T) {
		ln := listen(t)
		defer func() { _ = ln.Close() }()
		port := ln.Addr().(*net.TCPAddr).Port
		if !portInUse("127.0.0.1", port) {
			t.Error("expected portInUse to report true for a bound port")
		}
	})

	t.Run("false for a port nothing is listening on", func(t *testing.T) {
		ln := listen(t)
		port := ln.Addr().(*net.TCPAddr).Port
		_ = ln.Close()
		if portInUse("127.0.0.1", port) {
			t.Error("expected portInUse to report false for a closed port")
		}
	})
}
