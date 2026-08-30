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
	// Wraps fn to match lookupExecEnvFn's real signature (goal 0203 S3
	// added a SecretAccessRun param) -- every existing test call site
	// stays a plain func(id string), unchanged.
	lookupExecEnvFn = func(id string, _ SecretAccessRun) (ResolvedExecEnv, error) { return fn(id) }
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

// TestCodeExecution_PayloadRedacted proves a code-execution node's
// captured stdout+stderr is run through redactSecretsFn before it
// becomes ctx.Payload (goal 0203 S1's own redaction requirement, the
// same safety net mcp-tool-call's error text already has): a process
// started with a vault-resolved Env value could echo it straight back
// via a plain `echo`, and that must never reach the workflow's payload
// unredacted.
func TestCodeExecution_PayloadRedacted(t *testing.T) {
	origRedact := redactSecretsFn
	t.Cleanup(func() { redactSecretsFn = origRedact })
	swapExecEnvLookupForTest(t, func(string) (ResolvedExecEnv, error) {
		return ResolvedExecEnv{Shell: "sh", ProfileMode: "clean", Dir: t.TempDir(), Env: []string{"PATH=/bin:/usr/bin", "API_KEY=super-secret-fake"}}, nil
	})
	SetSecretRedactor(func(s string) string { return strings.ReplaceAll(s, "super-secret-fake", "[redacted]") })

	out, err := runCodeExecution(t, Node{ID: "n1", Config: map[string]string{
		"envId": "e1", "source": "literal", "script": `echo "$API_KEY"`, "timeoutSeconds": "10",
	}}, "")
	if err != nil {
		t.Fatalf("exec: %v", err)
	}
	if strings.Contains(out.Payload, "super-secret-fake") {
		t.Fatalf("Payload leaked the resolved secret: %q", out.Payload)
	}
	if !strings.Contains(out.Payload, "[redacted]") {
		t.Fatalf("Payload = %q, want the redaction placeholder", out.Payload)
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

// TestCodeExecution_LiteralPassInputStdin_PipesThePayload pins goal
// 0240 S5's pass-input default (the Shortcuts convention): a literal
// script receives the upstream payload on stdin.
func TestCodeExecution_LiteralPassInputStdin_PipesThePayload(t *testing.T) {
	swapExecEnvLookupForTest(t, func(id string) (ResolvedExecEnv, error) { return testExecEnv(t), nil })

	out, err := runCodeExecution(t, Node{ID: "n1", Config: map[string]string{
		"envId": "e1", "source": "literal", "script": `cat`, "timeoutSeconds": "10",
	}}, "payload on stdin\n")
	if err != nil {
		t.Fatalf("exec: %v", err)
	}
	if got := strings.TrimSpace(out.Payload); got != "payload on stdin" {
		t.Errorf("Payload = %q, want the piped input", got)
	}
}

// TestCodeExecution_LiteralPassInputArguments_OneArgPerLine pins the
// "as arguments" half: each payload line lands as its own positional
// argument, reachable as "$@".
func TestCodeExecution_LiteralPassInputArguments_OneArgPerLine(t *testing.T) {
	swapExecEnvLookupForTest(t, func(id string) (ResolvedExecEnv, error) { return testExecEnv(t), nil })

	out, err := runCodeExecution(t, Node{ID: "n1", Config: map[string]string{
		"envId": "e1", "source": "literal", "script": `printf '%s|' "$@"`, "passInput": "arguments", "timeoutSeconds": "10",
	}}, "alpha\nbeta\ngamma\n")
	if err != nil {
		t.Fatalf("exec: %v", err)
	}
	if got := strings.TrimSpace(out.Payload); got != "alpha|beta|gamma|" {
		t.Errorf("Payload = %q, want one argument per input line", got)
	}
}

// TestCodeExecution_SourcePayload_PassInputIgnored pins the no-op:
// source "payload" runs the payload AS the script, so there is no
// separate input to route and the passInput setting changes nothing.
func TestCodeExecution_SourcePayload_PassInputIgnored(t *testing.T) {
	swapExecEnvLookupForTest(t, func(id string) (ResolvedExecEnv, error) { return testExecEnv(t), nil })

	out, err := runCodeExecution(t, Node{ID: "n1", Config: map[string]string{
		"envId": "e1", "source": "payload", "passInput": "arguments", "timeoutSeconds": "10",
	}}, `echo unrouted`)
	if err != nil {
		t.Fatalf("exec: %v", err)
	}
	if got := strings.TrimSpace(out.Payload); got != "unrouted" {
		t.Errorf("Payload = %q, want %q", got, "unrouted")
	}
}

func TestInputArgs_LineSplitting(t *testing.T) {
	cases := []struct {
		in   string
		want []string
	}{
		{"", nil},
		{"one", []string{"one"}},
		{"a\nb\n", []string{"a", "b"}},
		{"a\n\nb", []string{"a", "", "b"}},
		{"a\r\nb\r\n", []string{"a", "b"}},
	}
	for _, c := range cases {
		got := inputArgs(c.in)
		if len(got) != len(c.want) {
			t.Errorf("inputArgs(%q) = %v, want %v", c.in, got, c.want)
			continue
		}
		for i := range got {
			if got[i] != c.want[i] {
				t.Errorf("inputArgs(%q)[%d] = %q, want %q", c.in, i, got[i], c.want[i])
			}
		}
	}
}

// TestAppendShellArgs_DollarZeroPlaceholder pins the POSIX -c operand
// convention: the first appended operand becomes $0, so the shell's
// own basename is inserted ahead of the real arguments.
func TestAppendShellArgs_DollarZeroPlaceholder(t *testing.T) {
	base := []string{"/bin/sh", "-c", "printf '%s' \"$1\""}
	got := appendShellArgs(base, []string{"first"})
	want := []string{"/bin/sh", "-c", "printf '%s' \"$1\"", "sh", "first"}
	if len(got) != len(want) {
		t.Fatalf("appendShellArgs = %v, want %v", got, want)
	}
	for i := range got {
		if got[i] != want[i] {
			t.Fatalf("appendShellArgs[%d] = %q, want %q", i, got[i], want[i])
		}
	}
	if out := appendShellArgs(base, nil); len(out) != len(base) {
		t.Fatalf("appendShellArgs with no args = %v, want argv unchanged", out)
	}
}
