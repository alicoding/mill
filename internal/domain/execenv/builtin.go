package execenv

// ExampleSafeSandboxID is the seeded example ExecEnv's ID -- exported
// so composition.BuiltInWorkflows' own "Example: Run copied code" seed
// (builtinworkflows.go) can reference it without a string literal that
// could drift, same pattern httprequest.ExampleNoneID/
// list.ExampleCountryCodesID/mcpserver.ExampleReferenceServerID already
// establish.
const ExampleSafeSandboxID = "example-safe-sandbox-execenv"

// BuiltIn returns the seeded example ExecEnv -- pure config, no
// persistence (mirrors httprequest.BuiltIn/list.BuiltIn/
// mcpserver.BuiltIn's shape: this package stays free of the
// settings-store concern, per CLAUDE.md's backend rule --
// ConfigureService owns seeding/top-up).
//
// ADR-0026's own seed decision, verbatim: "the seeded 'Safe sandbox'
// env is zsh + clean + Mill-created temp dir + minimal PATH." Clean
// profile mode is deterministic (no user shell config sourced); a
// fresh temp dir per run means nothing this seed executes can touch
// real user files by construction, regardless of what script a future
// user points at this environment; a minimal PATH (just the standard
// macOS/Linux system binary directories) is enough to resolve `echo`
// and other common coreutils without inheriting whatever a user's real
// shell PATH happens to contain (Homebrew taps, language version
// managers, etc -- exactly the "materialize, don't inherit" principle
// ADR-0026's Amendment names).
func BuiltIn() []ExecEnv {
	return []ExecEnv{
		{
			ID:          ExampleSafeSandboxID,
			Label:       "Example: Safe sandbox",
			Shell:       ShellZsh,
			ProfileMode: ProfileClean,
			Dir:         TempDirSentinel,
			Env:         []string{"PATH=/usr/bin:/bin:/usr/sbin:/sbin"},
			BuiltIn:     true,
		},
	}
}
