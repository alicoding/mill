package composition

import (
	"os"
	"sort"
	"strings"
)

// The coding loop's secret resolution CHAIN (docs/goals/0240 S2, closing
// docs/goals/0203 S4's held design): vault -> shell env -> prompt-me-to-
// type, one resolver with three ordered sources, never three separate
// code paths. "Fail to resolve" is banned by the goal's own decision --
// every function below either returns a value or reports "found: false"
// so the caller can fall through to the next source (or, at the very
// end of the chain, the Confirm screen's own typed-input field); nothing
// here ever returns an error for an unresolved secret.
//
// Two distinct operations share this file because they share the same
// three-source vocabulary but run at different times with different
// cost/audit postures:
//   - ResolveSecretRequirements (Confirm-time): classifies WHICH source
//     each referenced placeholder WOULD resolve from, for the preview --
//     a vault check here is a cheap label lookup, never a decrypt, so
//     previewing a block never itself produces an audit line.
//   - the runtime chain (executeshellcommand.go's use of
//     shellSecretResolverFn): resolves the REAL value at the moment a
//     step actually runs -- a vault hit here IS a real decrypt, and
//     leaves the existing goal-0203 audit line via the seam's own
//     production wiring (wiring.WireCodingLoopSecrets), never a second
//     audit store.

// SecretSource names which of the chain's three sources actually
// answered a placeholder -- shown on the Confirm screen per goal 0240's
// own design contract ("secrets it will need with their resolution
// source: vault name / env var / you'll type it") and returned
// alongside the runtime chain's resolved value so the redaction pass
// (executeshellcommand.go) knows every value it must scrub regardless
// of where it came from.
type SecretSource string

const (
	SecretSourceVault  SecretSource = "vault"
	SecretSourceEnv    SecretSource = "env"
	SecretSourcePrompt SecretSource = "prompt"
)

// SecretRequirement is one env-var-style secret placeholder a parsed
// command block references, plus which chain source will answer it --
// codeloopsvc's PreviewCommandBlock attaches one of these per name found
// by ExtractSecretEnvRefs.
type SecretRequirement struct {
	VarName string
	Source  SecretSource
	// VaultLabel is the matching vault entry's title, populated only
	// when Source is SecretSourceVault -- what the Confirm screen shows
	// next to "resolves from your vault."
	VaultLabel string
}

// ExtractSecretEnvRefs returns every secret-shaped env-var reference
// (secretEnvRefPattern) in text, as their bare variable names --
// sorted and deduplicated so a var referenced twice in one block (or
// once each in two steps, via ExtractSecretEnvRefsAll) produces exactly
// one requirement. Pure: no I/O, directly table-testable.
func ExtractSecretEnvRefs(text string) []string {
	matches := secretEnvRefPattern.FindAllStringSubmatch(text, -1)
	seen := make(map[string]struct{}, len(matches))
	names := make([]string, 0, len(matches))
	for _, m := range matches {
		name := m[1]
		if _, dup := seen[name]; dup {
			continue
		}
		seen[name] = struct{}{}
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// ExtractSecretEnvRefsAll runs ExtractSecretEnvRefs across every step
// and merges the result -- the whole captured block shares one Confirm-
// screen secrets list and one runtime env, regardless of which step(s)
// actually reference a given name.
func ExtractSecretEnvRefsAll(steps []ParsedCommandStep) []string {
	seen := make(map[string]struct{})
	var names []string
	for _, step := range steps {
		for _, name := range ExtractSecretEnvRefs(step.Text) {
			if _, dup := seen[name]; dup {
				continue
			}
			seen[name] = struct{}{}
			names = append(names, name)
		}
	}
	sort.Strings(names)
	return names
}

// lookupVaultSecretFn answers "does a vault entry name this env var" --
// a cheap label lookup (never a decrypt, never an audit line: goal
// 0203 S3's contract only audits an actual VALUE read). Defaults to
// "no vault" so every composition unit test runs without wiring.
// SetVaultSecretLookup installs the real lookup (wiring.
// WireCodingLoopSecrets, over secretsvc.ListSecrets' own masked
// summaries).
var lookupVaultSecretFn = func(_ string) (label string, found bool) { return "", false }

// SetVaultSecretLookup installs the preview-time vault-label lookup.
func SetVaultSecretLookup(fn func(varName string) (label string, found bool)) {
	lookupVaultSecretFn = fn
}

// ResolveSecretRequirements classifies each varName's chain source for
// the Confirm screen: a matching vault entry wins first, then the
// process's own real shell environment, then "you'll type it." Pure
// given the injected lookupVaultSecretFn -- never touches a real secret
// VALUE, only decides which source WOULD answer it.
func ResolveSecretRequirements(varNames []string) []SecretRequirement {
	out := make([]SecretRequirement, 0, len(varNames))
	for _, name := range varNames {
		if label, found := lookupVaultSecretFn(name); found {
			out = append(out, SecretRequirement{VarName: name, Source: SecretSourceVault, VaultLabel: label})
			continue
		}
		if os.Getenv(name) != "" {
			out = append(out, SecretRequirement{VarName: name, Source: SecretSourceEnv})
			continue
		}
		out = append(out, SecretRequirement{VarName: name, Source: SecretSourcePrompt})
	}
	return out
}

// shellSecretResolverFn is the RUNTIME chain: given one placeholder var
// name, this run's SecretsToken (codeloopsvc's typed-secrets stash key,
// secretAccessRunFromCtx's SecretAccessRun for audit attribution),
// returns the real value plus which source answered it. Defaults to a
// shell-env-only fallback (no vault, no typed stash reachable without
// wiring) so composition's own tests and any caller that never wires
// SetShellSecretResolver still behave like "the ambient environment
// already had it" -- the same posture Env:nil already gave every
// pre-S2 run. "Never fail to resolve" (goal 0240's own decision): the
// zero value (found=false) is a normal, expected outcome here, never
// logged or erred on by this seam's own callers -- the shell simply
// sees its own (possibly empty) ambient value for that name, exactly
// like any other unresolved env var.
var shellSecretResolverFn = func(varName, _ string, _ SecretAccessRun) (value string, source SecretSource, found bool) {
	if v := os.Getenv(varName); v != "" {
		return v, SecretSourceEnv, true
	}
	return "", "", false
}

// SetShellSecretResolver installs the real three-source chain
// (wiring.WireCodingLoopSecrets): typed-stash lookup, then vault
// decrypt+audit, then shell env.
func SetShellSecretResolver(fn func(varName, secretsToken string, run SecretAccessRun) (string, SecretSource, bool)) {
	shellSecretResolverFn = fn
}

// upsertEnv returns env with name=value set -- overriding an existing
// entry for name in place (preserving os.Environ()'s own ordering for
// everything else) rather than appending a duplicate, since a process's
// env with the same name listed twice is at best confusing and at
// worst shell-implementation-dependent about which wins.
func upsertEnv(env []string, name, value string) []string {
	prefix := name + "="
	for i, kv := range env {
		if strings.HasPrefix(kv, prefix) {
			env[i] = prefix + value
			return env
		}
	}
	return append(env, prefix+value)
}
