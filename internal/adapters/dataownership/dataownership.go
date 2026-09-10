// Package dataownership prevents independent Mill processes from writing the
// same local settings or execution data.
package dataownership

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/gofrs/flock"
)

// ExecutionOwnership states what this process can prove about the durable
// execution store. Callers use this classification; it is not a user choice.
type ExecutionOwnership string

const (
	ExecutionOwnershipExclusiveLocal ExecutionOwnership = "exclusive-local"
	ExecutionOwnershipPrivateMemory  ExecutionOwnership = "private-memory"
	ExecutionOwnershipUnestablished  ExecutionOwnership = "unestablished"
)

var (
	// ErrAlreadyOwned is deliberately path-free because a database URL may
	// contain credentials.
	ErrAlreadyOwned  = errors.New("Mill is already using these data files. Close that instance or choose different data paths.")    //nolint:staticcheck // This is final user-facing copy.
	ErrCannotProtect = errors.New("Mill could not protect its data files. Check that the data folder is writable, then try again.") //nolint:staticcheck // This is final user-facing copy.
)

// Handle retains every acquired descriptor until Close. Sidecar files remain
// on disk after release; only the operating-system lock denotes ownership.
type Handle struct {
	mu        sync.Mutex
	locks     []*flock.Flock
	execution ExecutionOwnership
	closed    bool
}

var (
	processMu      sync.Mutex
	processHandles []*Handle
)

// AcquireForProcess acquires and retains ownership until operating-system
// process teardown. Graceful shutdown must not release the locks because a
// timed-out execution body may still be running.
func AcquireForProcess(settingsPath, databaseURL string) (*Handle, error) {
	h, err := Acquire(settingsPath, databaseURL)
	if err != nil {
		return nil, err
	}
	processMu.Lock()
	processHandles = append(processHandles, h)
	processMu.Unlock()
	return h, nil
}

// Acquire takes nonblocking locks for the canonical settings path and, when
// DBOS identifies a local SQLite file, the canonical execution path.
func Acquire(settingsPath, databaseURL string) (*Handle, error) {
	execution, executionPath := classifyExecution(databaseURL)
	targets := []string{settingsPath}
	if executionPath != "" {
		targets = append(targets, executionPath)
	}
	canonical, err := canonicalTargets(targets)
	if err != nil {
		return nil, ErrCannotProtect
	}
	return acquireCanonicalTargets(canonical, execution)
}

func acquireCanonicalTargets(canonical []string, execution ExecutionOwnership) (*Handle, error) {
	h := &Handle{execution: execution}
	var identities []os.FileInfo
	for _, target := range canonical {
		lockPath, identity, err := prepareSidecar(target)
		if err != nil {
			_ = h.Close()
			return nil, ErrCannotProtect
		}
		duplicate := false
		for _, held := range identities {
			if os.SameFile(identity, held) {
				duplicate = true
				break
			}
		}
		if duplicate {
			continue
		}
		lock, err := tryLock(lockPath)
		if err != nil {
			_ = h.Close()
			return nil, ErrCannotProtect
		}
		if lock == nil {
			_ = h.Close()
			return nil, ErrAlreadyOwned
		}
		h.locks = append(h.locks, lock)
		identities = append(identities, identity)
	}
	return h, nil
}

// ExecutionOwnership returns the source-backed execution-store classification.
func (h *Handle) ExecutionOwnership() ExecutionOwnership {
	if h == nil {
		return ExecutionOwnershipUnestablished
	}
	return h.execution
}

// Close releases the acquired descriptors without deleting their sidecars.
func (h *Handle) Close() error {
	if h == nil {
		return nil
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return nil
	}
	h.closed = true
	var result error
	for i := len(h.locks) - 1; i >= 0; i-- {
		result = errors.Join(result, h.locks[i].Close())
	}
	return result
}

func canonicalTargets(targets []string) ([]string, error) {
	unique := make(map[string]struct{}, len(targets))
	for _, target := range targets {
		canonical, err := canonicalPath(target)
		if err != nil {
			return nil, err
		}
		unique[canonical] = struct{}{}
	}
	result := make([]string, 0, len(unique))
	for target := range unique {
		result = append(result, target)
	}
	sort.Strings(result)
	return result, nil
}

// canonicalPath resolves symlinks in the deepest existing ancestor as well as
// in an existing target. This keeps aliases identical before first creation.
func canonicalPath(path string) (string, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	abs = filepath.Clean(abs)
	if resolved, err := filepath.EvalSymlinks(abs); err == nil {
		return resolved, nil
	} else if !os.IsNotExist(err) {
		return "", err
	}

	existing := abs
	var suffix []string
	for {
		if _, err := os.Lstat(existing); err == nil {
			break
		} else if !os.IsNotExist(err) {
			return "", err
		}
		parent := filepath.Dir(existing)
		if parent == existing {
			return "", fmt.Errorf("no existing path ancestor")
		}
		suffix = append(suffix, filepath.Base(existing))
		existing = parent
	}
	resolved, err := filepath.EvalSymlinks(existing)
	if err != nil {
		return "", err
	}
	for i := len(suffix) - 1; i >= 0; i-- {
		resolved = filepath.Join(resolved, suffix[i])
	}
	return filepath.Clean(resolved), nil
}

func prepareSidecar(target string) (string, os.FileInfo, error) {
	dir := filepath.Join(filepath.Dir(target), ".mill-locks")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", nil, err
	}
	if err := os.Chmod(dir, 0o700); err != nil { //nolint:gosec // A private directory requires owner execute permission.
		return "", nil, err
	}
	lockPath := filepath.Join(dir, filepath.Base(target)+".lock")
	file, err := os.OpenFile(lockPath, os.O_CREATE|os.O_RDONLY, 0o600) //nolint:gosec // lockPath is derived from a canonical target within its private sidecar directory.
	if err != nil {
		return "", nil, err
	}
	if err := file.Close(); err != nil {
		return "", nil, err
	}
	if err := os.Chmod(lockPath, 0o600); err != nil {
		return "", nil, err
	}
	identity, err := os.Stat(lockPath)
	if err != nil {
		return "", nil, err
	}
	return lockPath, identity, nil
}

func tryLock(lockPath string) (*flock.Flock, error) {
	lock := flock.New(lockPath, flock.SetPermissions(0o600))
	locked, err := lock.TryLock()
	if err != nil {
		return nil, err
	}
	if !locked {
		return nil, nil
	}
	return lock, nil
}

// classifyExecution extracts DBOS v1.3.0's SQLite DSN, then resolves the
// modernc driver's actual file and memory forms. Other dialects and ambiguous
// SQLite forms cannot establish local execution ownership.
func classifyExecution(raw string) (ExecutionOwnership, string) {
	dsn, ok := sqliteDSN(raw)
	if !ok {
		return ExecutionOwnershipUnestablished, ""
	}
	if dsn == ":memory:" {
		return ExecutionOwnershipPrivateMemory, ""
	}
	path, ok := sqliteFilePath(dsn)
	if !ok || path == "" {
		return ExecutionOwnershipUnestablished, ""
	}
	if path == ":memory:" {
		return ExecutionOwnershipPrivateMemory, ""
	}
	return ExecutionOwnershipExclusiveLocal, path
}

func sqliteDSN(raw string) (string, bool) {
	u, err := url.Parse(raw)
	if err != nil || (strings.ToLower(u.Scheme) != "sqlite" && strings.ToLower(u.Scheme) != "sqlite3") || u.Host != "" {
		return "", false
	}
	dsn := u.Opaque
	if dsn == "" {
		dsn = u.Path
	}
	if dsn == "" {
		return "", false
	}
	if u.RawQuery != "" {
		dsn += "?" + u.RawQuery
	}
	if u.Fragment != "" {
		dsn += "#" + u.Fragment
	}
	if _, err := url.PathUnescape(dsn); err != nil {
		return "", false
	}
	return dsn, true
}

func sqliteFilePath(dsn string) (string, bool) {
	path := dsn
	if strings.HasPrefix(path, "file:") {
		u, err := url.Parse(path)
		if err != nil || u.Host != "" {
			return "", false
		}
		path = u.Opaque
		if path != "" {
			path, err = url.PathUnescape(path)
			if err != nil {
				return "", false
			}
		} else {
			path = u.Path
		}
	} else if i := strings.IndexByte(path, '?'); i >= 0 {
		path = path[:i]
	}
	return path, path != ""
}
