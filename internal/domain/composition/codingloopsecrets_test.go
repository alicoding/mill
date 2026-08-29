package composition

import (
	"reflect"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/secret"
)

func TestExtractSecretEnvRefs_BraceForm(t *testing.T) {
	got := ExtractSecretEnvRefs(`curl -H "Authorization: Bearer ${GITHUB_TOKEN}"`)
	if want := []string{"GITHUB_TOKEN"}; !reflect.DeepEqual(got, want) {
		t.Errorf("ExtractSecretEnvRefs = %v, want %v", got, want)
	}
}

func TestExtractSecretEnvRefs_BareForm(t *testing.T) {
	got := ExtractSecretEnvRefs(`echo $MY_API_KEY`)
	if want := []string{"MY_API_KEY"}; !reflect.DeepEqual(got, want) {
		t.Errorf("ExtractSecretEnvRefs = %v, want %v", got, want)
	}
}

func TestExtractSecretEnvRefs_NonSecretShapedVarIgnored(t *testing.T) {
	got := ExtractSecretEnvRefs(`echo $HOME ${USER}`)
	if len(got) != 0 {
		t.Errorf("ExtractSecretEnvRefs = %v, want none (HOME/USER aren't secret-shaped)", got)
	}
}

func TestExtractSecretEnvRefs_DedupesAcrossOneString(t *testing.T) {
	got := ExtractSecretEnvRefs(`echo ${API_TOKEN} && curl -H "Auth: ${API_TOKEN}"`)
	if want := []string{"API_TOKEN"}; !reflect.DeepEqual(got, want) {
		t.Errorf("ExtractSecretEnvRefs = %v, want %v (one entry, deduped)", got, want)
	}
}

func TestExtractSecretEnvRefsAll_MergesAcrossSteps(t *testing.T) {
	steps := []ParsedCommandStep{
		{Index: 0, Text: "echo ${GITHUB_TOKEN}"},
		{Index: 1, Text: "echo ${AWS_SECRET}"},
		{Index: 2, Text: "echo ${GITHUB_TOKEN}"},
	}
	got := ExtractSecretEnvRefsAll(steps)
	want := []string{"AWS_SECRET", "GITHUB_TOKEN"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("ExtractSecretEnvRefsAll = %v, want %v", got, want)
	}
}

func TestResolveSecretRequirements_ChainOrder(t *testing.T) {
	orig := lookupVaultSecretFn
	t.Cleanup(func() { lookupVaultSecretFn = orig })
	SetVaultSecretLookup(func(varName string) (string, bool) {
		if varName == "VAULT_TOKEN" {
			return "GitHub PAT", true
		}
		return "", false
	})

	t.Setenv("ENV_TOKEN", "already-in-shell-env")

	reqs := ResolveSecretRequirements([]string{"VAULT_TOKEN", "ENV_TOKEN", "PROMPT_TOKEN"})
	if len(reqs) != 3 {
		t.Fatalf("ResolveSecretRequirements returned %d requirements, want 3", len(reqs))
	}

	if reqs[0].Source != SecretSourceVault || reqs[0].VaultLabel != "GitHub PAT" {
		t.Errorf("VAULT_TOKEN = %+v, want vault/\"GitHub PAT\"", reqs[0])
	}
	if reqs[1].Source != SecretSourceEnv {
		t.Errorf("ENV_TOKEN = %+v, want env", reqs[1])
	}
	if reqs[2].Source != SecretSourcePrompt {
		t.Errorf("PROMPT_TOKEN = %+v, want prompt (no vault entry, no env var)", reqs[2])
	}
}

func TestUpsertEnv_OverridesExistingEntryInPlace(t *testing.T) {
	env := []string{"PATH=/usr/bin", "TOKEN=old"}
	got := upsertEnv(env, "TOKEN", "new")
	want := []string{"PATH=/usr/bin", "TOKEN=new"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("upsertEnv = %v, want %v", got, want)
	}
}

func TestUpsertEnv_AppendsWhenAbsent(t *testing.T) {
	got := upsertEnv([]string{"PATH=/usr/bin"}, "TOKEN", "new")
	want := []string{"PATH=/usr/bin", "TOKEN=new"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("upsertEnv = %v, want %v", got, want)
	}
}

// TestProcessShellCommandExec_SecretChain_ResolvesAndRedactsFromRecord is
// the goal 0240 S2 regression this slice's own contract requires: a
// resolved secret substitutes for real (the shell actually sees the
// value, proven by the command's own conditional logic firing on it)
// but never survives into the recorded Payload -- the redaction pass
// scrubs it regardless of which chain source produced it.
func TestProcessShellCommandExec_SecretChain_ResolvesAndRedactsFromRecord(t *testing.T) {
	origResolver := shellSecretResolverFn
	t.Cleanup(func() { shellSecretResolverFn = origResolver })
	const fixtureSecret = "sk-test-fixture-value-should-never-be-recorded" //nolint:gosec // a test fixture value, not a real credential
	SetShellSecretResolver(func(varName, _ string, _ SecretAccessRun) (string, SecretSource, bool) {
		if varName == "MY_TEST_SECRET" {
			return fixtureSecret, SecretSourceVault, true
		}
		return "", "", false
	})

	// The command TEXT itself only ever names the placeholder (never the
	// value -- env-var injection's own structural safety, this file's
	// header comment) -- the OUTPUT is where a resolved secret could
	// leak, e.g. a command that echoes its own env back, so that's what
	// this test actually exercises.
	out, err := runShellCommand(t, `echo "resolved=$MY_TEST_SECRET"`)
	if err != nil {
		t.Fatalf("exec: %v", err)
	}
	if strings.Contains(out.Payload, fixtureSecret) {
		t.Fatalf("Payload = %q, contains the raw resolved secret value -- must be redacted", out.Payload)
	}
	if !strings.Contains(out.Payload, secret.RedactedPlaceholder) {
		t.Errorf("Payload = %q, want the echoed secret scrubbed to the redaction placeholder", out.Payload)
	}
}

// TestProcessShellCommandExec_SecretChain_UnresolvedNeverFailsTheRun pins
// goal 0240's own "never fail to resolve" ban: a referenced placeholder
// with no chain source available leaves the shell to see its own
// (empty) ambient value, never a Go error from Mill's own resolution.
func TestProcessShellCommandExec_SecretChain_UnresolvedNeverFailsTheRun(t *testing.T) {
	origResolver := shellSecretResolverFn
	t.Cleanup(func() { shellSecretResolverFn = origResolver })
	SetShellSecretResolver(func(string, string, SecretAccessRun) (string, SecretSource, bool) {
		return "", "", false
	})

	out, err := runShellCommand(t, `echo "value=${UNRESOLVED_TEST_TOKEN_XYZ}done"`)
	if err != nil {
		t.Fatalf("exec: %v, want no error even though the secret never resolved", err)
	}
	if !strings.Contains(out.Payload, "value=done") {
		t.Errorf("Payload = %q, want the unresolved var to expand to empty rather than blocking the run", out.Payload)
	}
}

// TestProcessShellCommandExec_SecretChain_NoRefsLeavesEnvNil proves
// resolveShellSecretEnv's own "no wasted os.Environ() copy" contract:
// a block with no secret-shaped placeholder at all never builds an
// explicit env list.
func TestProcessShellCommandExec_SecretChain_NoRefsLeavesEnvNil(t *testing.T) {
	env, redactValues := resolveShellSecretEnv(
		[]ParsedCommandStep{{Index: 0, Text: "echo hello"}},
		ExecContext{},
		nil,
	)
	if env != nil {
		t.Errorf("env = %v, want nil (no secret placeholder referenced)", env)
	}
	if redactValues != nil {
		t.Errorf("redactValues = %v, want nil", redactValues)
	}
}

// TestSecretRedact_UsesRedactedPlaceholder pins that this file's own
// redaction pass reuses secret.RedactedPlaceholder -- the SAME marker
// goal 0185 S4's vault-wide redaction already uses, never a second
// convention.
func TestSecretRedact_UsesRedactedPlaceholder(t *testing.T) {
	got := secret.Redact([]string{"top-secret"}, "value=top-secret")
	if !strings.Contains(got, secret.RedactedPlaceholder) {
		t.Errorf("Redact = %q, want it to contain %q", got, secret.RedactedPlaceholder)
	}
}
