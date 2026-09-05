package configuresvc

import (
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/adapters/secretaudit"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/environment"
	"github.com/alicoding/mill/internal/domain/execenv"
	"github.com/alicoding/mill/internal/domain/httprequest"
)

func TestResolveEnvironment_PlainAndSecretVariables(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	secrets := secretStoreOf(t, cfg)
	ref := secrets.Put("Portal token", "real-token-fake")

	env, err := cfg.CreateEnvironment("Sandbox", []environment.Variable{
		{Key: "API_BASE", Value: "https://sandbox.test"},
		{Key: "API_TOKEN", Value: ref, Secret: true},
		{Key: "UNSET_TOKEN", Secret: true},
	})
	if err != nil {
		t.Fatalf("CreateEnvironment: %v", err)
	}

	resolved, err := cfg.resolveEnvironment(env.ID, composition.SecretAccessRun{})
	if err != nil {
		t.Fatalf("resolveEnvironment: %v", err)
	}
	if resolved.Label != "Sandbox" {
		t.Errorf("Label = %q", resolved.Label)
	}
	if resolved.Vars["API_BASE"] != "https://sandbox.test" {
		t.Errorf("plain variable = %q", resolved.Vars["API_BASE"])
	}
	if resolved.Vars["API_TOKEN"] != "real-token-fake" {
		t.Errorf("secret variable = %q, want the resolved store value", resolved.Vars["API_TOKEN"])
	}
	if v, ok := resolved.Vars["UNSET_TOKEN"]; !ok || v != "" {
		t.Errorf("secret variable with no reference = %q/%v, want an empty value that still exists", v, ok)
	}
}

// A secret variable's read is attributable: one audit context, named
// for the environment rather than for whichever request happened to
// reference it.
func TestResolveEnvironment_SecretReadCarriesTheEnvironmentContext(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	var seen []secretaudit.AccessContext
	cfg.SetSecretResolver(func(_ string, actx secretaudit.AccessContext) (string, error) {
		seen = append(seen, actx)
		return "v", nil
	})
	env, err := cfg.CreateEnvironment("Sandbox", []environment.Variable{
		{Key: "PLAIN", Value: "literal"},
		{Key: "TOKEN", Value: "vault:e1", Secret: true},
	})
	if err != nil {
		t.Fatalf("CreateEnvironment: %v", err)
	}
	if _, err := cfg.resolveEnvironment(env.ID, composition.SecretAccessRun{RunID: "r1", WorkflowID: "w1"}); err != nil {
		t.Fatalf("resolveEnvironment: %v", err)
	}
	if len(seen) != 1 {
		t.Fatalf("resolver called %d times, want once (only the secret variable)", len(seen))
	}
	if seen[0].Context != secretaudit.ContextEnvironmentVar || seen[0].RunID != "r1" || seen[0].WorkflowID != "w1" {
		t.Errorf("audit context = %+v, want the environment-var context carrying the run", seen[0])
	}
}

func TestEnvironmentVarGap_SeededRequestResolvesOnlyInSandbox(t *testing.T) {
	cfg, _ := newTestConfigureServiceWithSeeds(t)

	if gaps := cfg.environmentVarGap(httprequest.ExampleEnvironmentID, environment.ExampleSandboxID); len(gaps) != 0 {
		t.Errorf("gaps in Sandbox = %v, want none", gaps)
	}
	if gaps := cfg.environmentVarGap(httprequest.ExampleEnvironmentID, environment.ExampleProductionID); len(gaps) != 0 {
		t.Errorf("gaps in Production = %v, want none -- both seeds define API_BASE", gaps)
	}
	gaps := cfg.environmentVarGap(httprequest.ExampleEnvironmentID, "")
	if len(gaps) != 1 || gaps[0] != "API_BASE" {
		t.Errorf("gaps with no environment = %v, want [API_BASE]", gaps)
	}
	if gaps := cfg.environmentVarGap(httprequest.ExampleNoneID, ""); len(gaps) != 0 {
		t.Errorf("gaps for a request with no variables = %v, want none", gaps)
	}
}

func TestDeleteEnvironment_RefusedWhileAWorkflowDefaultsToIt(t *testing.T) {
	cfg, comp := newTestConfigureServiceWithSeeds(t)

	err := cfg.DeleteEnvironment(environment.ExampleSandboxID)
	if err == nil {
		t.Fatal("DeleteEnvironment on an environment a workflow defaults to returned nil, want it blocked")
	}
	if !strings.Contains(err.Error(), "Post an update to the client portal") {
		t.Errorf("blocked-error = %q, want it to name the referencing workflow", err.Error())
	}

	if _, err := comp.SetWorkflowDefaultEnvironment("example-guarded-http-workflow", ""); err != nil {
		t.Fatalf("SetWorkflowDefaultEnvironment (clearing the reference): %v", err)
	}
	if err := cfg.DeleteEnvironment(environment.ExampleSandboxID); err != nil {
		t.Fatalf("DeleteEnvironment after clearing the reference: %v", err)
	}
}

func TestDeleteEnvironment_RefusedWhileAShellBorrowsIt(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	env, err := cfg.CreateEnvironment("Sandbox", []environment.Variable{{Key: "A", Value: "1"}})
	if err != nil {
		t.Fatalf("CreateEnvironment: %v", err)
	}
	if _, err := cfg.CreateExecEnv("Shell", execenv.ShellSh, execenv.ProfileClean, execenv.TempDirSentinel, nil, env.ID); err != nil {
		t.Fatalf("CreateExecEnv: %v", err)
	}
	if err := cfg.DeleteEnvironment(env.ID); err == nil || !strings.Contains(err.Error(), "Shell") {
		t.Fatalf("DeleteEnvironment = %v, want it blocked naming the execution environment", err)
	}
}

// The merge is base-then-override: the Environment's variables are
// materialized first and the shell's own entries appended, so a shared
// key resolves to the shell's value.
func TestResolveExecEnv_EnvironmentVariablesMergeUnderTheShellsOwn(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	env, err := cfg.CreateEnvironment("Sandbox", []environment.Variable{
		{Key: "API_BASE", Value: "https://sandbox.test"},
		{Key: "SHARED", Value: "from-environment"},
	})
	if err != nil {
		t.Fatalf("CreateEnvironment: %v", err)
	}
	e, err := cfg.CreateExecEnv("Shell", execenv.ShellSh, execenv.ProfileClean, execenv.TempDirSentinel, []string{"SHARED=from-shell"}, env.ID)
	if err != nil {
		t.Fatalf("CreateExecEnv: %v", err)
	}
	rs, err := cfg.resolveExecEnv(e.ID, composition.SecretAccessRun{})
	if err != nil {
		t.Fatalf("resolveExecEnv: %v", err)
	}
	want := []string{"API_BASE=https://sandbox.test", "SHARED=from-environment", "SHARED=from-shell"}
	if len(rs.Env) != len(want) {
		t.Fatalf("Env = %v, want %v", rs.Env, want)
	}
	for i := range want {
		if rs.Env[i] != want[i] {
			t.Fatalf("Env = %v, want %v (the shell's own entry must come last)", rs.Env, want)
		}
	}
}

func TestCreateEnvironment_RejectsADuplicateVariableName(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	if _, err := cfg.CreateEnvironment("Sandbox", []environment.Variable{{Key: "A", Value: "1"}, {Key: "A", Value: "2"}}); err == nil {
		t.Fatal("CreateEnvironment with a duplicate variable name returned nil, want an error")
	}
}

func TestExportEnvironment_CarriesReferencesNeverValues(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	secrets := secretStoreOf(t, cfg)
	ref := secrets.Put("Portal token", "real-token-fake")
	env, err := cfg.CreateEnvironment("Sandbox", []environment.Variable{{Key: "API_TOKEN", Value: ref, Secret: true}})
	if err != nil {
		t.Fatalf("CreateEnvironment: %v", err)
	}
	data, err := cfg.ExportEnvironment(env.ID)
	if err != nil {
		t.Fatalf("ExportEnvironment: %v", err)
	}
	if strings.Contains(data, "real-token-fake") {
		t.Fatal("export carries the resolved secret value")
	}
	if !strings.Contains(data, ref) {
		t.Errorf("export = %s, want it to carry the reference", data)
	}
}

func TestDescribeEnvironment_SaysWhenASecretVariableNeedsAValue(t *testing.T) {
	cfg, _ := newTestConfigureService(t)
	env, err := cfg.CreateEnvironment("Sandbox", []environment.Variable{
		{Key: "API_BASE", Value: "https://sandbox.test"},
		{Key: "API_TOKEN", Secret: true},
	})
	if err != nil {
		t.Fatalf("CreateEnvironment: %v", err)
	}
	summary, err := cfg.DescribeReference("environment", env.ID)
	if err != nil {
		t.Fatalf("DescribeReference: %v", err)
	}
	if len(summary.Lines) != 2 || summary.Lines[0].Value != "https://sandbox.test" || summary.Lines[1].Value != needsAValue {
		t.Errorf("lines = %+v", summary.Lines)
	}
	if len(summary.Problems) != 1 || !strings.Contains(summary.Problems[0], "API_TOKEN") {
		t.Errorf("problems = %v, want one naming API_TOKEN", summary.Problems)
	}
}
