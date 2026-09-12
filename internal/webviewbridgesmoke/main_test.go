package main

import (
	"context"
	"errors"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/services/pluginsvc"
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

// Regression: the liveness probe must report a LIVE process as alive.
// Signal(nil) fails the Unix implementation's syscall.Signal type
// assertion and errors for any process, which made waitForBridge
// declare every app launch dead on its first poll.
func TestProcExited(t *testing.T) {
	cmd := exec.CommandContext(context.Background(), "sleep", "30")
	if err := cmd.Start(); err != nil {
		t.Fatalf("start sleep: %v", err)
	}
	defer func() { _ = cmd.Process.Kill(); _, _ = cmd.Process.Wait() }()

	if procExited(cmd.Process) {
		t.Fatal("procExited reported a live process as exited")
	}

	if err := cmd.Process.Kill(); err != nil {
		t.Fatalf("kill: %v", err)
	}
	if _, err := cmd.Process.Wait(); err != nil {
		t.Fatalf("wait: %v", err)
	}
	if !procExited(cmd.Process) {
		t.Fatal("procExited reported a reaped process as alive")
	}
}

func TestIsolatedAppEnvironmentReplacesEveryMutablePath(t *testing.T) {
	tmpDir := t.TempDir()
	base := []string{
		"PATH=/usr/bin",
		"MILL_SETTINGS_PATH=/real/settings.json",
		"MILL_EXECUTION_DB_PATH=/real/execution.db",
		"MILL_EXECUTION_DATABASE_URL=postgres://real",
		"MILL_SECRETS_PATH=/real/secrets.kdbx",
		"MILL_BACKUP_DIR=/real/backups",
		"MILL_PLUGINS_DIR=/real/plugins",
		"MILL_ATLAS_MIRRORS_DIR=/real/mirrors",
		"MILL_ATLAS_CAPTURES_DIR=/real/captures",
		"MILL_TEST_KEYRING=system",
		"MILL_MCP_ADDR=127.0.0.1:4444",
		"MILL_BRIDGE_ADDR=127.0.0.1:5555",
		"WAILS_MCP_HOST=production.example",
		"WAILS_MCP_PORT=1234",
	}
	want := map[string]string{
		"MILL_SETTINGS_PATH":          filepath.Join(tmpDir, "settings.json"),
		"MILL_EXECUTION_DB_PATH":      filepath.Join(tmpDir, "execution.db"),
		"MILL_EXECUTION_DATABASE_URL": "sqlite:" + filepath.Join(tmpDir, "execution.db"),
		"MILL_SECRETS_PATH":           filepath.Join(tmpDir, "secrets.kdbx"),
		"MILL_BACKUP_DIR":             filepath.Join(tmpDir, "backups"),
		"MILL_PLUGINS_DIR":            filepath.Join(tmpDir, "plugins"),
		"MILL_ATLAS_MIRRORS_DIR":      filepath.Join(tmpDir, "mirrors"),
		"MILL_ATLAS_CAPTURES_DIR":     filepath.Join(tmpDir, "captures"),
		"MILL_TEST_KEYRING":           "memory",
		"MILL_MCP_ADDR":               "127.0.0.1:0",
		"MILL_BRIDGE_ADDR":            "127.0.0.1:0",
		"WAILS_MCP_HOST":              mcpHost,
		"WAILS_MCP_PORT":              strconv.Itoa(mcpPort),
	}

	got := isolatedAppEnvironment(base, tmpDir)
	for key, value := range want {
		var matches []string
		for _, entry := range got {
			if strings.HasPrefix(entry, key+"=") {
				matches = append(matches, strings.TrimPrefix(entry, key+"="))
			}
		}
		if len(matches) != 1 || matches[0] != value {
			t.Errorf("%s values = %q, want [%q]", key, matches, value)
		}
	}
	if !slices.Contains(got, "PATH=/usr/bin") {
		t.Fatal("unrelated child environment was not preserved")
	}
}

func TestValidateShutdownBackupRequiresSettingsAndSourceIdentity(t *testing.T) {
	tmpDir := t.TempDir()
	snapshotDir := filepath.Join(tmpDir, "backups", "20260101-010203.000")
	pluginSnapshotDir := filepath.Join(snapshotDir, "plugin-state")
	if err := os.MkdirAll(pluginSnapshotDir, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(snapshotDir, "settings.json"), []byte(`{"profile":"smoke"}`), 0o600); err != nil {
		t.Fatal(err)
	}

	sourceDir := filepath.Join(tmpDir, "source")
	if err := os.MkdirAll(filepath.Join(sourceDir, ".mill"), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sourceDir, ".mill", "marketplace.json"), []byte(`{"name":"webview-smoke-source","owner":{"name":"Mill smoke"},"plugins":[]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	pluginDir := filepath.Join(tmpDir, "plugins")
	service := pluginsvc.New(pluginDir, nil, "")
	t.Cleanup(func() {
		if err := service.CloseState(); err != nil {
			t.Errorf("CloseState: %v", err)
		}
	})
	source, err := service.AddMarketplaceSource(sourceDir)
	if err != nil {
		t.Fatal(err)
	}
	if err := pluginsvc.SnapshotStoredState(pluginDir, pluginSnapshotDir); err != nil {
		t.Fatal(err)
	}
	identity := shutdownSource{Name: source.Name, Incarnation: source.Incarnation}
	if err := validateShutdownBackup(tmpDir, identity); err != nil {
		t.Fatal(err)
	}
	if err := validateShutdownBackup(tmpDir, shutdownSource{Name: identity.Name, Incarnation: "replaced"}); err == nil {
		t.Fatal("validateShutdownBackup accepted a different source incarnation")
	}
}
