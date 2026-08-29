package composition

import (
	"reflect"
	"testing"
)

// The shell step's optional execution-environment target
// (docs/goals/0240 S4): an envId routes the block through the SAME
// ExecEnv machinery code-execution uses -- shellArgv's clean/login
// flags, resolveDir, explicit-only env with the minimal-PATH default
// -- while an empty envId keeps S1's documented posture (the user's
// real login shell and real environment) byte-for-byte.

func withExecEnvLookup(t *testing.T, re ResolvedExecEnv) {
	t.Helper()
	orig := lookupExecEnvFn
	lookupExecEnvFn = func(envID string, _ SecretAccessRun) (ResolvedExecEnv, error) { return re, nil }
	t.Cleanup(func() { lookupExecEnvFn = orig })
}

func TestResolveShellCommandRunTarget_EnvSet_UsesExecEnvMachinery(t *testing.T) {
	dir := t.TempDir()
	withExecEnvLookup(t, ResolvedExecEnv{
		Shell: "sh", ProfileMode: "clean", Dir: dir,
		Env: []string{"FOO=bar"}, Label: "Safe sandbox",
	})

	target, err := resolveShellCommandRunTarget("some-env", SecretAccessRun{})
	if err != nil {
		t.Fatalf("resolveShellCommandRunTarget: %v", err)
	}
	if target.EnvLabel != "Safe sandbox" {
		t.Errorf("EnvLabel = %q, want the environment's own label", target.EnvLabel)
	}
	if target.Dir != dir {
		t.Errorf("Dir = %q, want the environment's dir %q", target.Dir, dir)
	}
	if !reflect.DeepEqual(target.env, []string{"FOO=bar"}) {
		t.Errorf("env = %v, want the environment's explicit env", target.env)
	}
	// The spawn argv carries sh's clean invocation, not a bare `-c`.
	if got := target.argvFor("echo hi"); !reflect.DeepEqual(got, []string{"/bin/sh", "-c", "echo hi"}) {
		t.Errorf("argvFor = %v, want sh clean-mode argv", got)
	}
}

func TestResolveShellCommandRunTarget_EnvWithEmptyEnv_GetsMinimalPATH(t *testing.T) {
	dir := t.TempDir()
	withExecEnvLookup(t, ResolvedExecEnv{Shell: "zsh", ProfileMode: "login", Dir: dir, Label: "L"})

	target, err := resolveShellCommandRunTarget("some-env", SecretAccessRun{})
	if err != nil {
		t.Fatalf("resolveShellCommandRunTarget: %v", err)
	}
	if !reflect.DeepEqual(target.env, []string{"PATH=/usr/bin:/bin:/usr/sbin:/sbin"}) {
		t.Errorf("env = %v, want the minimal PATH default (explicit-only, never os.Environ)", target.env)
	}
	if got := target.argvFor("pwd"); !reflect.DeepEqual(got, []string{"/bin/zsh", "-l", "-c", "pwd"}) {
		t.Errorf("argvFor = %v, want zsh login-mode argv", got)
	}
}

func TestResolveShellCommandRunTarget_EmptyEnvID_KeepsDefaultPosture(t *testing.T) {
	target, err := resolveShellCommandRunTarget("", SecretAccessRun{})
	if err != nil {
		t.Fatalf("resolveShellCommandRunTarget: %v", err)
	}
	if target.EnvLabel != "" || target.env != nil {
		t.Errorf("target = %+v, want no env label and a nil (inherit-the-real-environment) env", target)
	}
	base := ResolveShellCommandTarget()
	if got := target.argvFor("echo hi"); !reflect.DeepEqual(got, []string{base.Shell, "-c", "echo hi"}) {
		t.Errorf("argvFor = %v, want the bare login-shell -c invocation", got)
	}
}

// A block-referenced secret upserts onto the ENVIRONMENT's explicit
// env, never onto os.Environ -- the two postures must not mix.
func TestResolveShellSecretEnv_ExplicitBaseStaysExplicit(t *testing.T) {
	origResolver := shellSecretResolverFn
	shellSecretResolverFn = func(varName string, _ string, _ SecretAccessRun) (string, SecretSource, bool) {
		return "resolved-value", SecretSourceVault, true
	}
	t.Cleanup(func() { shellSecretResolverFn = origResolver })

	steps := []ParsedCommandStep{{Index: 0, Text: "curl -H \"Authorization: $API_TOKEN\" https://x.test"}}
	env, redact := resolveShellSecretEnv(steps, ExecContext{}, []string{"FOO=bar"})
	want := []string{"FOO=bar", "API_TOKEN=resolved-value"}
	if !reflect.DeepEqual(env, want) {
		t.Errorf("env = %v, want the explicit base plus the upserted secret (never os.Environ)", env)
	}
	if !reflect.DeepEqual(redact, []string{"resolved-value"}) {
		t.Errorf("redact = %v, want the resolved value", redact)
	}
}
