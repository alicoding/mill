// Command webviewbridgesmoke drives the real desktop app (a -tags mcp
// build, Wails3's own MCP control bridge -- see
// .claude/skills/run-mill/SKILL.md's spike notes) through a small named
// registry of checks (checks.go), over the real macOS WKWebView engine
// instead of Playwright's Chromium/webkit browsers. Exists because
// docs/goals/0097's DoR research found no macOS WebDriver for a
// third-party app's embedded WKWebView, and Playwright's own "webkit"
// build never attaches to it either (patched WebKit-main, not Safari) --
// this bridge is the one mechanism that drives the actual shipped
// engine.
//
// Invoke via scripts/webview-bridge-smoke.sh, not directly -- the
// script is the documented entrypoint (local pre-release gate, or a
// non-required CI job, per the goal's CI-feasibility verdict).
package main

import (
	"context"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"syscall"
	"time"
)

const (
	mcpHost        = "127.0.0.1"
	mcpPort        = 9099
	appBootTimeout = 30 * time.Second
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "webview-bridge-smoke: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	repoRoot, err := repoRootFromWD()
	if err != nil {
		return err
	}

	if err := guardNoOtherInstance(); err != nil {
		return err
	}

	tmpDir, err := os.MkdirTemp("", "mill-webview-bridge-smoke-")
	if err != nil {
		return fmt.Errorf("create temp dir: %w", err)
	}
	defer func() { _ = os.RemoveAll(tmpDir) }()

	binPath := filepath.Join(tmpDir, "mill-bridge-smoke")
	if err := buildApp(repoRoot, binPath); err != nil {
		return err
	}

	proc, stderrTail, err := launchApp(repoRoot, binPath, tmpDir)
	if err != nil {
		return err
	}
	defer stopProcess(proc)

	client := newMCPClient(mcpHost, mcpPort)
	if err := waitForBridge(client, proc, appBootTimeout); err != nil {
		return fmt.Errorf("%w\napp stderr tail:\n%s", err, stderrTail())
	}

	// Before ANY check may run call_bound_method: stash the app's event
	// dispatcher so callBoundJSON can chain it back after the bridge's
	// runtime import steals the slot (see checks.go's repair comment).
	if err := captureAppDispatch(client); err != nil {
		return fmt.Errorf("capture app event dispatcher: %w", err)
	}

	return runRegistry(client, registry)
}

// runRegistry runs each check in order and reports PASS/FAIL, stopping
// immediately (never substituting a different tool) the moment a check
// hits a genuine bridge API gap rather than a mere assertion failure --
// caller and checks are parameters, not the package globals, so the
// aggregation logic here is exercisable against a scripted fake.
func runRegistry(caller mcpCaller, checks []check) error {
	var failed int
	for _, chk := range checks {
		detail, err := chk.run(caller)
		if err != nil {
			failed++
			fmt.Printf("FAIL  %-28s %v\n", chk.name, err)
			var gap *bridgeGapError
			if ok := asBridgeGapError(err, &gap); ok {
				return fmt.Errorf("stopping: check %q needs bridge tool %q, which the bridge does not support -- report this, never substitute a different tool: %s", chk.name, gap.tool, gap.message)
			}
			continue
		}
		fmt.Printf("PASS  %-28s %s\n", chk.name, detail)
	}
	if failed > 0 {
		return fmt.Errorf("%d/%d checks failed", failed, len(checks))
	}
	fmt.Printf("all %d checks passed\n", len(checks))
	return nil
}

func asBridgeGapError(err error, target **bridgeGapError) bool {
	if gap, ok := err.(*bridgeGapError); ok {
		*target = gap
		return true
	}
	return false
}

func repoRootFromWD() (string, error) {
	wd, err := os.Getwd()
	if err != nil {
		return "", fmt.Errorf("getwd: %w", err)
	}
	return repoRootFrom(wd)
}

// repoRootFrom walks up from startDir looking for go.mod -- split out of
// repoRootFromWD so the walk itself is testable against a real temp
// directory tree without needing to chdir the test process.
func repoRootFrom(startDir string) (string, error) {
	dir := startDir
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("no go.mod found above %s -- run from inside the mill repo", startDir)
		}
		dir = parent
	}
}

// buildApp always rebuilds the frontend (production mode, matching what
// ships) before the -tags mcp Go binary -- same stale-build-identity
// reasoning frontend/e2e/global-setup.ts documents for its own rebuild:
// this script exists specifically to gate a release-shaped build, so a
// stale frontend/dist would silently smoke-test the wrong artifact.
func buildApp(repoRoot, outPath string) error {
	npmBuild := exec.Command("npm", "run", "build") //nolint:gosec,noctx // static args, one-shot CLI invocation, no cancellation source to plumb through (matches internal/devguard's own precedent)
	npmBuild.Dir = filepath.Join(repoRoot, "frontend")
	npmBuild.Stdout = os.Stdout
	npmBuild.Stderr = os.Stderr
	if err := npmBuild.Run(); err != nil {
		return fmt.Errorf("npm run build: %w", err)
	}

	goBuild := exec.Command("go", "build", "-tags", "mcp", "-o", outPath, ".") //nolint:gosec,noctx // outPath is our own generated temp path, not untrusted input; one-shot CLI tool
	goBuild.Dir = repoRoot
	goBuild.Stdout = os.Stdout
	goBuild.Stderr = os.Stderr
	if err := goBuild.Run(); err != nil {
		return fmt.Errorf("go build -tags mcp: %w", err)
	}
	return nil
}

// launchApp spawns the real desktop binary directly (no shell), isolated
// from any real Mill data the same way frontend/e2e/fixtures/server.ts
// isolates each worker's server -- a throwaway settings/execution-db
// pair under tmpDir, never the user's real files.
func launchApp(repoRoot, binPath, tmpDir string) (*os.Process, func() string, error) {
	cmd := exec.Command(binPath) //nolint:gosec,noctx // binPath is our own just-built temp binary, not untrusted input; lifecycle is managed via stopProcess, not a context
	cmd.Dir = repoRoot
	cmd.Env = append(os.Environ(),
		"WAILS_MCP_HOST="+mcpHost,
		"WAILS_MCP_PORT="+strconv.Itoa(mcpPort),
		"MILL_SETTINGS_PATH="+filepath.Join(tmpDir, "settings.json"),
		"MILL_EXECUTION_DB_PATH="+filepath.Join(tmpDir, "execution.db"),
	)
	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return nil, nil, fmt.Errorf("stdout pipe: %w", err)
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return nil, nil, fmt.Errorf("stderr pipe: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return nil, nil, fmt.Errorf("start %s: %w", binPath, err)
	}
	tail := tailLines(stdoutPipe, stderrPipe, 50)
	return cmd.Process, tail, nil
}

// waitForBridge polls app_info until the MCP HTTP server answers, or the
// process exits early (a crash-on-boot must fail fast, not wait out the
// full timeout).
func waitForBridge(client *mcpClient, proc *os.Process, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	var lastErr error
	for time.Now().Before(deadline) {
		_, callErr := client.call("app_info", map[string]any{})
		if callErr == nil {
			return nil
		}
		lastErr = callErr
		if procExited(proc) {
			return fmt.Errorf("app process exited before the MCP bridge became reachable: %w", lastErr)
		}
		time.Sleep(300 * time.Millisecond)
	}
	return fmt.Errorf("timed out waiting for MCP bridge at %s:%d: %w", mcpHost, mcpPort, lastErr)
}

func procExited(proc *os.Process) bool {
	// Signal 0 probes liveness without affecting the process --
	// documented Unix kill(2) behaviour, exec.Process exposes no
	// higher-level equivalent. It must be syscall.Signal(0), never a
	// nil os.Signal: Signal's Unix implementation type-asserts its
	// argument to syscall.Signal, and a nil interface fails that
	// assertion, so Signal(nil) errors for a perfectly alive process
	// and this probe would declare every launch dead on its first
	// poll.
	return proc.Signal(syscall.Signal(0)) != nil
}

// stopProcess quits exactly the PID this script itself launched --
// never a broader pkill/killall (forbidden: a broad pkill has taken
// down a real production mill-server before).
func stopProcess(proc *os.Process) {
	if proc == nil {
		return
	}
	_ = proc.Signal(os.Interrupt)
	done := make(chan struct{})
	go func() {
		_, _ = proc.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		_ = proc.Kill()
		<-done
	}
}

func portInUse(host string, port int) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	dialer := net.Dialer{}
	conn, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(host, strconv.Itoa(port)))
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}
