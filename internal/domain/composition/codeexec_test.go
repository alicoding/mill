package composition

import (
	"os"
	"strings"
	"testing"
)

// swapExecEnvLookupForTest installs fn as the exec-env lookup seam and
// returns a restore func -- same swap/restore discipline
// executionsvc's own swapHTTPRequestLookup uses for its package-level
// var, applied here since composition has no test-scoped accessor of
// its own for lookupExecEnvFn either.
func swapExecEnvLookupForTest(t *testing.T, fn func(id string) (ResolvedExecEnv, error)) {
	t.Helper()
	orig := lookupExecEnvFn
	lookupExecEnvFn = fn
	t.Cleanup(func() { lookupExecEnvFn = orig })
}

func testExecEnv(t *testing.T) ResolvedExecEnv {
	t.Helper()
	return ResolvedExecEnv{Shell: "sh", ProfileMode: "clean", Dir: t.TempDir(), Env: []string{"PATH=/bin:/usr/bin"}}
}

func runCodeExecution(t *testing.T, node Node, payload string) (ExecContext, error) {
	t.Helper()
	entry, ok := nodeTypeRegistry["code-execution"]
	if !ok {
		t.Fatal(`node type "code-execution" is not registered`)
	}
	return entry.exec(node, ExecContext{Payload: payload, Attributes: map[string]any{}})
}

// TestCodeExecution_SourcePayload_RunsThePayload proves the real
// procexec path, not a fake -- SPEC §2.1's core loop (a captured
// command actually executes) exercised end to end for the "payload"
// source.
func TestCodeExecution_SourcePayload_RunsThePayload(t *testing.T) {
	swapExecEnvLookupForTest(t, func(id string) (ResolvedExecEnv, error) { return testExecEnv(t), nil })

	out, err := runCodeExecution(t, Node{ID: "n1", Config: map[string]string{
		"envId": "e1", "source": "payload", "timeoutSeconds": "10",
	}}, `echo hello-payload`)
	if err != nil {
		t.Fatalf("exec: %v", err)
	}
	if got := strings.TrimSpace(out.Payload); got != "hello-payload" {
		t.Errorf("Payload = %q, want %q", got, "hello-payload")
	}
}

func TestCodeExecution_SourceLiteral_RunsTheScript(t *testing.T) {
	swapExecEnvLookupForTest(t, func(id string) (ResolvedExecEnv, error) { return testExecEnv(t), nil })

	out, err := runCodeExecution(t, Node{ID: "n1", Config: map[string]string{
		"envId": "e1", "source": "literal", "script": `echo hello-literal`, "timeoutSeconds": "10",
	}}, `this payload must be ignored`)
	if err != nil {
		t.Fatalf("exec: %v", err)
	}
	if got := strings.TrimSpace(out.Payload); got != "hello-literal" {
		t.Errorf("Payload = %q, want %q", got, "hello-literal")
	}
}

func TestCodeExecution_NonZeroExit_Fails(t *testing.T) {
	swapExecEnvLookupForTest(t, func(id string) (ResolvedExecEnv, error) { return testExecEnv(t), nil })

	_, err := runCodeExecution(t, Node{ID: "n1", Config: map[string]string{
		"envId": "e1", "source": "literal", "script": `exit 3`, "timeoutSeconds": "10",
	}}, "")
	if err == nil {
		t.Fatal("exec = nil error, want an error for a non-zero exit")
	}
	if !strings.Contains(err.Error(), "exit code 3") {
		t.Errorf("err = %q, want it to mention exit code 3", err)
	}
}

// TestCodeExecution_EnvIsolation_OnlyPassedEnvVisible proves
// ADR-0026's "materialize, don't inherit" principle end to end through
// codeexec.go, not just at procexec's own layer: a real environment
// variable set on THIS test process must NOT leak into the child,
// since ExecEnv.Env is explicit-only.
func TestCodeExecution_EnvIsolation_OnlyPassedEnvVisible(t *testing.T) {
	t.Setenv("MILL_TEST_LEAK_CANARY", "leaked-value")
	swapExecEnvLookupForTest(t, func(id string) (ResolvedExecEnv, error) { return testExecEnv(t), nil })

	out, err := runCodeExecution(t, Node{ID: "n1", Config: map[string]string{
		"envId": "e1", "source": "literal", "script": `echo "[$MILL_TEST_LEAK_CANARY]"`, "timeoutSeconds": "10",
	}}, "")
	if err != nil {
		t.Fatalf("exec: %v", err)
	}
	if got := strings.TrimSpace(out.Payload); got != "[]" {
		t.Errorf("Payload = %q, want %q (the ambient env var must not leak into the child)", got, "[]")
	}
}

func TestCodeExecution_EmptyEnv_GetsMinimalPATHDefault(t *testing.T) {
	swapExecEnvLookupForTest(t, func(id string) (ResolvedExecEnv, error) {
		return ResolvedExecEnv{Shell: "sh", ProfileMode: "clean", Dir: t.TempDir(), Env: nil}, nil
	})

	// `command -v echo` needs SOME PATH to resolve a coreutil -- proves
	// the minimal-PATH default kicks in for a genuinely empty Env,
	// rather than the process having no PATH at all.
	out, err := runCodeExecution(t, Node{ID: "n1", Config: map[string]string{
		"envId": "e1", "source": "literal", "script": `command -v echo`, "timeoutSeconds": "10",
	}}, "")
	if err != nil {
		t.Fatalf("exec: %v", err)
	}
	if strings.TrimSpace(out.Payload) == "" {
		t.Error("Payload is empty, want a resolved path to echo (minimal PATH default should apply)")
	}
}

func TestCodeExecution_TempDirSentinel_ResolvesToARealExistingDir(t *testing.T) {
	swapExecEnvLookupForTest(t, func(id string) (ResolvedExecEnv, error) {
		return ResolvedExecEnv{Shell: "sh", ProfileMode: "clean", Dir: "<mill-temp>", Env: []string{"PATH=/bin:/usr/bin"}}, nil
	})

	out, err := runCodeExecution(t, Node{ID: "n1", Config: map[string]string{
		"envId": "e1", "source": "literal", "script": `pwd`, "timeoutSeconds": "10",
	}}, "")
	if err != nil {
		t.Fatalf("exec: %v", err)
	}
	dir := strings.TrimSpace(out.Payload)
	if dir == "" {
		t.Fatal("Payload is empty, want the minted temp dir's path")
	}
	if _, err := os.Stat(dir); err != nil {
		t.Errorf("minted dir %q does not exist: %v", dir, err)
	}
}

func TestCodeExecution_EmptyCommand_Fails(t *testing.T) {
	swapExecEnvLookupForTest(t, func(id string) (ResolvedExecEnv, error) { return testExecEnv(t), nil })

	_, err := runCodeExecution(t, Node{ID: "n1", Config: map[string]string{
		"envId": "e1", "source": "payload", "timeoutSeconds": "10",
	}}, "   ")
	if err == nil {
		t.Fatal("exec = nil error, want an error for an empty command")
	}
}

func TestShellArgv_CleanAndLoginModesPerShell(t *testing.T) {
	cases := []struct {
		shell, profile string
		want           []string
	}{
		{"zsh", "clean", []string{"/bin/zsh", "--no-rcs", "-c", "S"}},
		{"zsh", "login", []string{"/bin/zsh", "-l", "-c", "S"}},
		{"bash", "clean", []string{"/bin/bash", "--noprofile", "--norc", "-c", "S"}},
		{"bash", "login", []string{"/bin/bash", "-l", "-c", "S"}},
		{"sh", "clean", []string{"/bin/sh", "-c", "S"}},
		{"sh", "login", []string{"/bin/sh", "-l", "-c", "S"}},
	}
	for _, c := range cases {
		got := shellArgv(c.shell, c.profile, "S")
		if len(got) != len(c.want) {
			t.Errorf("shellArgv(%q, %q) = %v, want %v", c.shell, c.profile, got, c.want)
			continue
		}
		for i := range got {
			if got[i] != c.want[i] {
				t.Errorf("shellArgv(%q, %q) = %v, want %v", c.shell, c.profile, got, c.want)
				break
			}
		}
	}
}
