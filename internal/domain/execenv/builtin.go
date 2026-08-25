package execenv

import "github.com/alicoding/mill/internal/domain/seedorigin"

// ExampleSafeSandboxID is the seeded example ExecEnv's ID -- exported
// so composition.BuiltInWorkflows' own "Example: Run copied code" seed
// (builtinworkflows.go) can reference it without a string literal that
// could drift, same pattern httprequest.ExampleNoneID/
// list.ExampleCountryCodesID/mcpserver.ExampleReferenceServerID already
// establish.
const ExampleSafeSandboxID = "example-safe-sandbox-execenv"

// ExampleSecretGuardID is the seeded example ExecEnv's ID for goal
// 0203 S2's own guardrail-attribute proof (composition.
// builtinworkflows_secretguard.go's "Example: uses a stored secret"
// workflow) -- same exported-const convention as ExampleSafeSandboxID.
const ExampleSecretGuardID = "example-secret-guard-execenv"

// BuiltIn returns the seeded example ExecEnv -- pure config, no
// persistence (mirrors httprequest.BuiltIn/list.BuiltIn/
// mcpserver.BuiltIn's shape: this package stays free of the
// settings-store concern, per CLAUDE.md's backend rule --
// ConfigureService owns seeding/top-up).
//
// ADR-0026's own seed decision, verbatim: "the seeded 'Safe sandbox'
// env is [sh] + clean + Mill-created temp dir + minimal PATH." Clean
// profile mode is deterministic (no user shell config sourced); a
// fresh temp dir per run means nothing this seed executes can touch
// real user files by construction, regardless of what script a future
// user points at this environment; a minimal PATH (just the standard
// macOS/Linux system binary directories) is enough to resolve `echo`
// and other common coreutils without inheriting whatever a user's real
// shell PATH happens to contain (Homebrew taps, language version
// managers, etc -- exactly the "materialize, don't inherit" principle
// ADR-0026's Amendment names).
//
// Shell is sh, not zsh (ADR-0026's Correction): zsh is a
// macOS-only default (ships since Catalina) that most headless Linux
// distributions -- including this repo's own Linux server-mode CI
// target, docs/SPEC.md §1.3 -- don't install, which made this seed
// unable to run anything at all there. POSIX sh is guaranteed present
// on both and satisfies the same clean/deterministic intent.
func BuiltIn() []ExecEnv {
	return []ExecEnv{
		{
			ID:          ExampleSafeSandboxID,
			Label:       "Example: Safe sandbox",
			Shell:       ShellSh,
			ProfileMode: ProfileClean,
			Dir:         TempDirSentinel,
			Env:         []string{"PATH=/usr/bin:/bin:/usr/sbin:/sbin"},
			BuiltIn:     true,
			Seed:        seedorigin.Stamp(1),
		},
		// A second, dedicated ExecEnv (never shared with the "Safe
		// sandbox" seed above) so goal 0203 S2's own guardrail-attribute
		// proof can carry a "vault:<id>" reference (Env's own documented
		// convention, above) without touching an env already exercised
		// by an unrelated approve-and-run seed test. The id is
		// deliberately dangling -- no vault-seeding mechanism exists to
		// pair it with a real entry -- which is fine for this seed's own
		// purpose: it demonstrates that ANY "vault:" reference (resolved
		// or not) is visible to the guardrail gate, never that this
		// particular one resolves.
		{
			ID:          ExampleSecretGuardID,
			Label:       "Example: uses a stored secret",
			Shell:       ShellSh,
			ProfileMode: ProfileClean,
			Dir:         TempDirSentinel,
			Env:         []string{"PATH=/usr/bin:/bin:/usr/sbin:/sbin", "API_TOKEN=vault:example-secret-guard-token"},
			BuiltIn:     true,
			Seed:        seedorigin.Stamp(1),
		},
	}
}
