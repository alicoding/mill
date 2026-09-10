package dataownership

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func TestExecutionOwnershipClassification(t *testing.T) {
	tests := []struct {
		name string
		url  string
		want ExecutionOwnership
	}{
		{name: "absolute sqlite", url: "sqlite:/tmp/execution.db", want: ExecutionOwnershipExclusiveLocal},
		{name: "triple slash sqlite", url: "sqlite:///tmp/execution.db", want: ExecutionOwnershipExclusiveLocal},
		{name: "relative sqlite", url: "sqlite:execution.db", want: ExecutionOwnershipExclusiveLocal},
		{name: "sqlite3", url: "sqlite3:execution.db", want: ExecutionOwnershipExclusiveLocal},
		{name: "file uri", url: "sqlite:file:/tmp/execution.db?_pragma=foreign_keys(1)", want: ExecutionOwnershipExclusiveLocal},
		{name: "memory", url: "sqlite::memory:", want: ExecutionOwnershipPrivateMemory},
		{name: "memory with query", url: "sqlite::memory:?cache=shared", want: ExecutionOwnershipPrivateMemory},
		{name: "memory suffix is a file", url: "sqlite::memory:other", want: ExecutionOwnershipExclusiveLocal},
		{name: "shared process memory", url: "sqlite:file::memory:?cache=shared", want: ExecutionOwnershipPrivateMemory},
		{name: "file memory suffix is a file", url: "sqlite:file::memory:other", want: ExecutionOwnershipExclusiveLocal},
		{name: "postgres url", url: "postgres://user:secret@example.test/db", want: ExecutionOwnershipUnestablished}, //nolint:gosec // A credential-bearing URL must remain opaque.
		{name: "postgres key value", url: "password=secret host=example.test", want: ExecutionOwnershipUnestablished},
		{name: "sqlite authority", url: "sqlite://server/path", want: ExecutionOwnershipUnestablished},
		{name: "file authority", url: "sqlite:file://server/path", want: ExecutionOwnershipUnestablished},
		{name: "missing sqlite path", url: "sqlite:", want: ExecutionOwnershipUnestablished},
		{name: "malformed", url: "sqlite:%zz", want: ExecutionOwnershipUnestablished},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, _ := classifyExecution(tt.url)
			if got != tt.want {
				t.Fatalf("classifyExecution() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestClassificationMatchesSQLiteFileSemantics(t *testing.T) {
	dir := t.TempDir()
	oldDir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(dir); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(oldDir) })

	for _, dsn := range []string{":memory:", ":memory:?cache=shared", "file::memory:?cache=shared"} {
		db, err := sql.Open("sqlite", dsn)
		if err != nil {
			t.Fatal(err)
		}
		if err := db.PingContext(context.Background()); err != nil {
			t.Fatal(err)
		}
		_ = db.Close()
	}
	if entries, err := os.ReadDir(dir); err != nil || len(entries) != 0 {
		t.Fatalf("memory databases created disk files: entries=%v error=%v", entries, err)
	}

	db, err := sql.Open("sqlite", ":memory:other")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.PingContext(context.Background()); err != nil {
		t.Fatal(err)
	}
	_ = db.Close()
	if _, err := os.Stat(filepath.Join(dir, ":memory:other")); err != nil {
		t.Fatalf("SQLite did not create the classified local file: %v", err)
	}
	if err := os.Remove(filepath.Join(dir, ":memory:other")); err != nil {
		t.Fatal(err)
	}

	db, err = sql.Open("sqlite", "file::memory:other")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.PingContext(context.Background()); err != nil {
		t.Fatal(err)
	}
	_ = db.Close()
	if _, err := os.Stat(filepath.Join(dir, ":memory:other")); err != nil {
		t.Fatalf("SQLite file URI suffix did not create a local file: %v", err)
	}
	if err := os.Remove(filepath.Join(dir, ":memory:other")); err != nil {
		t.Fatal(err)
	}

	encodedPath := filepath.Join(dir, "encoded data.db")
	fileURI := (&url.URL{Scheme: "file", Path: encodedPath}).String()
	db, err = sql.Open("sqlite", fileURI)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.PingContext(context.Background()); err != nil {
		t.Fatal(err)
	}
	_ = db.Close()
	if _, err := os.Stat(encodedPath); err != nil {
		t.Fatalf("SQLite file URI did not decode to the classified path: %v", err)
	}

	db, err = sql.Open("sqlite", "file:opaque%20data.db")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.PingContext(context.Background()); err != nil {
		t.Fatal(err)
	}
	_ = db.Close()
	if _, err := os.Stat(filepath.Join(dir, "opaque data.db")); err != nil {
		t.Fatalf("SQLite opaque file URI did not decode exactly once: %v", err)
	}

}

func TestAcquireSubprocessMatrix(t *testing.T) {
	dir := t.TempDir()
	settingsA := filepath.Join(dir, "a", "settings.json")
	databaseA := filepath.Join(dir, "a", "execution.db")
	settingsB := filepath.Join(dir, "b", "settings.json")
	databaseB := filepath.Join(dir, "b", "execution.db")

	t.Run("same settings conflicts", func(t *testing.T) {
		owner := startOwner(t, settingsA, databaseA)
		defer owner.stop(t)
		_, err := Acquire(settingsA, "sqlite:"+databaseB)
		if !errors.Is(err, ErrAlreadyOwned) {
			t.Fatalf("Acquire() error = %v, want ErrAlreadyOwned", err)
		}
	})

	t.Run("same sqlite with different settings conflicts", func(t *testing.T) {
		owner := startOwner(t, settingsA, databaseA)
		defer owner.stop(t)
		_, err := Acquire(settingsB, "sqlite:"+databaseA)
		if !errors.Is(err, ErrAlreadyOwned) {
			t.Fatalf("Acquire() error = %v, want ErrAlreadyOwned", err)
		}
	})

	t.Run("fully disjoint paths succeed", func(t *testing.T) {
		owner := startOwner(t, settingsA, databaseA)
		defer owner.stop(t)
		h, err := Acquire(settingsB, "sqlite:"+databaseB)
		if err != nil {
			t.Fatalf("Acquire() = %v, want nil", err)
		}
		if err := h.Close(); err != nil {
			t.Fatalf("Close() = %v", err)
		}
	})

	t.Run("symlink aliases conflict", func(t *testing.T) {
		realDir := filepath.Join(dir, "real")
		if err := os.MkdirAll(realDir, 0o750); err != nil {
			t.Fatal(err)
		}
		aliasDir := filepath.Join(dir, "alias")
		if err := os.Symlink(realDir, aliasDir); err != nil {
			t.Fatal(err)
		}
		owner := startOwner(t, filepath.Join(realDir, "settings.json"), filepath.Join(realDir, "execution.db"))
		defer owner.stop(t)
		_, err := Acquire(filepath.Join(aliasDir, "settings.json"), "sqlite:"+filepath.Join(aliasDir, "other.db"))
		if !errors.Is(err, ErrAlreadyOwned) {
			t.Fatalf("Acquire() error = %v, want ErrAlreadyOwned", err)
		}
		owner.stop(t)
		h, err := Acquire(filepath.Join(realDir, "settings.json"), "sqlite:"+filepath.Join(aliasDir, "settings.json"))
		if err != nil {
			t.Fatalf("Acquire() with two aliases in one process = %v", err)
		}
		if len(h.locks) != 1 {
			t.Fatalf("Acquire() retained %d locks for one symlink-aliased file, want 1", len(h.locks))
		}
		if err := h.Close(); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("file uri percent encoding aliases the same sqlite file", func(t *testing.T) {
		encodedDatabase := filepath.Join(dir, "encoded", "execution data.db")
		owner := startOwner(t, settingsA, encodedDatabase)
		defer owner.stop(t)
		fileURI := (&url.URL{Scheme: "file", Path: encodedDatabase}).String()
		_, err := Acquire(settingsB, "sqlite:"+fileURI)
		if !errors.Is(err, ErrAlreadyOwned) {
			t.Fatalf("Acquire() error = %v, want ErrAlreadyOwned", err)
		}
	})

	t.Run("opaque file uri percent encoding aliases the same sqlite file", func(t *testing.T) {
		encodedDir := filepath.Join(dir, "opaque")
		if err := os.MkdirAll(encodedDir, 0o750); err != nil {
			t.Fatal(err)
		}
		oldDir, err := os.Getwd()
		if err != nil {
			t.Fatal(err)
		}
		if err := os.Chdir(encodedDir); err != nil {
			t.Fatal(err)
		}
		defer func() {
			if err := os.Chdir(oldDir); err != nil {
				t.Error(err)
			}
		}()

		owner := startOwner(t, settingsA, "opaque data.db")
		defer owner.stop(t)
		_, err = Acquire(settingsB, "sqlite:file:opaque%20data.db")
		if !errors.Is(err, ErrAlreadyOwned) {
			t.Fatalf("Acquire() error = %v, want ErrAlreadyOwned", err)
		}
	})

	t.Run("case aliases conflict on a case-insensitive filesystem", func(t *testing.T) {
		caseDir := filepath.Join(dir, "case")
		if err := os.MkdirAll(caseDir, 0o750); err != nil {
			t.Fatal(err)
		}
		lower := filepath.Join(caseDir, "execution.db")
		upper := filepath.Join(caseDir, "EXECUTION.DB")
		if err := os.WriteFile(lower, nil, 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := os.Stat(upper); err != nil {
			t.Skip("filesystem is case-sensitive")
		}
		owner := startOwner(t, settingsA, lower)
		defer owner.stop(t)
		_, err := Acquire(settingsB, "sqlite:"+upper)
		if !errors.Is(err, ErrAlreadyOwned) {
			t.Fatalf("Acquire() error = %v, want ErrAlreadyOwned", err)
		}
		owner.stop(t)
		h, err := Acquire(lower, "sqlite:"+upper)
		if err != nil {
			t.Fatalf("Acquire() with two case aliases in one process = %v", err)
		}
		if len(h.locks) != 1 {
			t.Fatalf("Acquire() retained %d locks for one case-aliased file, want 1", len(h.locks))
		}
		if err := h.Close(); err != nil {
			t.Fatal(err)
		}
	})
}

func TestPartialAcquisitionRollsBack(t *testing.T) {
	dir := t.TempDir()
	first := filepath.Join(dir, "a", "settings.json")
	second := filepath.Join(dir, "z", "execution.db")
	owner := startRawOwner(t, []string{second})
	defer owner.stop(t)

	_, err := Acquire(first, "sqlite:"+second)
	if !errors.Is(err, ErrAlreadyOwned) {
		t.Fatalf("Acquire() error = %v, want ErrAlreadyOwned", err)
	}
	h, err := acquireRaw([]string{first})
	if err != nil {
		t.Fatalf("first target remained locked after rollback: %v", err)
	}
	_ = h.Close()
}

func TestOwnershipSurvivesUntilProcessExitAndSidecarsRemain(t *testing.T) {
	dir := t.TempDir()
	settingsPath := filepath.Join(dir, "settings.json")
	databasePath := filepath.Join(dir, "execution.db")
	owner := startOwner(t, settingsPath, databasePath)
	waitForFile(t, owner.shutdownReturned, "simulated shutdown return")

	if _, err := Acquire(settingsPath, "sqlite:"+databasePath); !errors.Is(err, ErrAlreadyOwned) {
		t.Fatalf("Acquire() after shutdown returned but before process exit = %v, want ErrAlreadyOwned", err)
	}
	owner.stop(t)
	h, err := Acquire(settingsPath, "sqlite:"+databasePath)
	if err != nil {
		t.Fatalf("Acquire() after process exit = %v", err)
	}
	if got := h.ExecutionOwnership(); got != ExecutionOwnershipExclusiveLocal {
		t.Fatalf("ExecutionOwnership() = %q", got)
	}
	if err := h.Close(); err != nil {
		t.Fatal(err)
	}

	entries, err := os.ReadDir(filepath.Join(dir, ".mill-locks"))
	if err != nil || len(entries) != 2 {
		t.Fatalf("sidecars after release = %d, %v; want 2 retained", len(entries), err)
	}
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			t.Fatal(err)
		}
		if runtime.GOOS != "windows" && info.Mode().Perm() != 0o600 {
			t.Fatalf("sidecar mode = %o, want 600", info.Mode().Perm())
		}
	}
}

func TestAcquireDoesNotExposeDatabaseURL(t *testing.T) {
	secretURL := "postgres://user:top-secret@example.test/db" //nolint:gosec // Errors must not expose credential-bearing configuration.
	h, err := Acquire(filepath.Join(t.TempDir(), "settings.json"), secretURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := h.Close(); err != nil {
			t.Error(err)
		}
	})
	if got := h.ExecutionOwnership(); got != ExecutionOwnershipUnestablished {
		t.Fatalf("ExecutionOwnership() = %q", got)
	}
}

type ownerProcess struct {
	cmd              *exec.Cmd
	release          string
	shutdownReturned string
}

func startOwner(t *testing.T, settingsPath, databasePath string) *ownerProcess {
	t.Helper()
	return startOwnerCommand(t, []string{settingsPath, databasePath}, true)
}

func startRawOwner(t *testing.T, targets []string) *ownerProcess {
	t.Helper()
	return startOwnerCommand(t, targets, false)
}

func startOwnerCommand(t *testing.T, targets []string, processLifetime bool) *ownerProcess {
	t.Helper()
	dir := t.TempDir()
	ready := filepath.Join(dir, "ready")
	release := filepath.Join(dir, "release")
	shutdownReturned := filepath.Join(dir, "shutdown-returned")
	payload, err := json.Marshal(targets)
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.CommandContext(context.Background(), os.Args[0], "-test.run=^TestOwnershipProcessHelper$") //nolint:gosec // The fixed executable is this test binary.
	cmd.Env = append(os.Environ(),
		"MILL_OWNERSHIP_HELPER=1",
		"MILL_OWNERSHIP_TARGETS="+string(payload),
		"MILL_OWNERSHIP_READY="+ready,
		"MILL_OWNERSHIP_RELEASE="+release,
		"MILL_OWNERSHIP_SHUTDOWN_RETURNED="+shutdownReturned,
	)
	if processLifetime {
		cmd.Env = append(cmd.Env, "MILL_OWNERSHIP_PROCESS=1")
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	owner := &ownerProcess{cmd: cmd, release: release, shutdownReturned: shutdownReturned}
	t.Cleanup(func() {
		if cmd.ProcessState == nil {
			owner.stop(t)
		}
	})
	deadline := time.Now().Add(5 * time.Second)
	waitForFileBefore(t, ready, "ownership helper readiness", deadline)
	return owner
}

func (o *ownerProcess) stop(t *testing.T) {
	t.Helper()
	if o == nil || o.cmd.ProcessState != nil {
		return
	}
	if err := os.WriteFile(o.release, []byte("release"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := o.cmd.Wait(); err != nil {
		t.Fatalf("ownership helper: %v", err)
	}
}

func waitForFile(t *testing.T, path, description string) {
	t.Helper()
	waitForFileBefore(t, path, description, time.Now().Add(5*time.Second))
}

func waitForFileBefore(t *testing.T, path, description string, deadline time.Time) {
	t.Helper()
	for time.Now().Before(deadline) {
		if _, err := os.Stat(path); err == nil {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", description)
}

func TestOwnershipProcessHelper(t *testing.T) {
	if os.Getenv("MILL_OWNERSHIP_HELPER") != "1" {
		return
	}
	var targets []string
	if err := json.Unmarshal([]byte(os.Getenv("MILL_OWNERSHIP_TARGETS")), &targets); err != nil {
		t.Fatal(err)
	}
	var h *Handle
	var err error
	if os.Getenv("MILL_OWNERSHIP_PROCESS") == "1" {
		if len(targets) != 2 {
			t.Fatalf("process ownership helper got %d targets, want 2", len(targets))
		}
		h, err = AcquireForProcess(targets[0], "sqlite:"+targets[1])
	} else {
		h, err = acquireRaw(targets)
	}
	if err != nil {
		t.Fatal(err)
	}
	if os.Getenv("MILL_OWNERSHIP_PROCESS") != "1" {
		t.Cleanup(func() {
			if err := h.Close(); err != nil {
				t.Error(err)
			}
		})
	}
	if err := os.WriteFile(os.Getenv("MILL_OWNERSHIP_READY"), []byte("ready"), 0o600); err != nil { //nolint:gosec // Parent owns the isolated test path.
		t.Fatal(err)
	}
	if err := os.WriteFile(os.Getenv("MILL_OWNERSHIP_SHUTDOWN_RETURNED"), []byte("returned"), 0o600); err != nil { //nolint:gosec // Parent owns the isolated test path.
		t.Fatal(err)
	}
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(os.Getenv("MILL_OWNERSHIP_RELEASE")); err == nil { //nolint:gosec // Parent owns the isolated test path.
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("release was not signaled")
}

func acquireRaw(targets []string) (*Handle, error) {
	canonical, err := canonicalTargets(targets)
	if err != nil {
		return nil, err
	}
	return acquireCanonicalTargets(canonical, ExecutionOwnershipUnestablished)
}
